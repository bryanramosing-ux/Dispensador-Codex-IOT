import {
  CanActivate,
  Controller,
  ExecutionContext,
  Global,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  UseGuards,
  Body,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { Config, localIp } from '../config/config';
import { DtoPipe, fail } from '../config/http';

const cookieName = 'dispensador_session';
const same = (left: string, right: string) =>
  timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
export const peerIp = (req: Request) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

@Injectable()
export class SecurityService {
  private readonly counters = new Map<string, { count: number; until: number }>();
  private sweepAt = 0;
  constructor(private readonly config: Config) {}

  limit(key: string, max: number, seconds: number): boolean {
    const now = Date.now();
    if (now >= this.sweepAt) {
      this.sweepAt = now + 30000;
      for (const [bucket, value] of this.counters) if (value.until <= now) this.counters.delete(bucket);
    }
    const current = this.counters.get(key);
    if (!current || current.until <= now) {
      if (this.counters.size >= 4096 && !current) return false;
      this.counters.set(key, { count: 1, until: now + seconds * 1000 });
      return true;
    }
    return ++current.count <= max;
  }

  middleware(req: Request, res: Response, next: NextFunction) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!this.limit('http:' + peerIp(req), 240, 60)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ ok: false, error: 'demasiadas solicitudes' });
      return;
    }
    next();
  }

  originAllowed(req: Request, origin: string) {
    if (this.config.origins.has(origin)) return true;
    try {
      const parsed = new URL(origin);
      const protocol = this.config.env.COOKIE_SECURE === '1' ? 'https' : req.protocol;
      return parsed.origin === origin && origin === protocol + '://' + req.get('host');
    } catch {
      return false;
    }
  }

  dashboardRequest(req: Request) {
    if (req.get('X-Requested-With') !== 'dashboard') fail(403, 'falta X-Requested-With');
    const origin = req.get('origin');
    if (origin && !this.originAllowed(req, origin)) fail(403, 'origen no permitido');
  }

  private sign(exp: string) {
    return createHmac('sha256', this.config.env.SESSION_SECRET)
      .update('admin:' + exp)
      .digest('base64url');
  }

  authenticated(req: Request) {
    const raw = req
      .get('cookie')
      ?.split(';')
      .map((field) => field.trim())
      .find((field) => field.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    const match = raw?.match(/^(\d{1,12})\.([\w-]{43})$/);
    return !!match && Number(match[1]) > Date.now() / 1000 && same(this.sign(match[1]), match[2]);
  }

  login(req: Request, res: Response, password: string) {
    this.dashboardRequest(req);
    if (!this.limit('login:' + peerIp(req), 6, 60)) fail(429, 'demasiados intentos');
    if (!same(password, this.config.env.ADMIN_PASSWORD)) fail(401, 'credenciales inválidas');
    const exp = String(Math.floor(Date.now() / 1000) + this.config.env.SESSION_TTL_S);
    res.cookie(cookieName, exp + '.' + this.sign(exp), {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.env.COOKIE_SECURE === '1',
      maxAge: this.config.env.SESSION_TTL_S * 1000,
      path: '/',
    });
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly security: SecurityService) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method !== 'GET' && req.method !== 'HEAD') this.security.dashboardRequest(req);
    if (!this.security.authenticated(req)) fail(401, 'inicie sesión');
    return true;
  }
}

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    private readonly config: Config,
    private readonly security: SecurityService,
  ) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = peerIp(req);
    const token = this.config.env.TOKEN_DISPOSITIVO;
    if (
      !token ||
      !same(req.get('X-Device-Token') ?? '', token) ||
      !localIp(ip, this.config.test) ||
      (this.config.deviceIp && ip !== this.config.deviceIp)
    )
      fail(401, 'token de dispositivo inválido');
    if (!this.security.limit('device:' + ip, 100, 60)) fail(429, 'demasiadas solicitudes');
    return true;
  }
}

@Controller('api/session')
class SessionController {
  constructor(
    private readonly security: SecurityService,
    private readonly config: Config,
  ) {}
  @Get()
  session(@Req() req: Request) {
    return { authenticated: this.security.authenticated(req) };
  }

  @Post()
  @HttpCode(200)
  login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new DtoPipe(z.strictObject({ password: z.string().max(240) }), () => 'credenciales inválidas'))
    body: { password: string },
  ) {
    this.security.login(req, res, body.password);
    return { ok: true };
  }

  @Post('logout')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.env.COOKIE_SECURE === '1',
    });
    return { ok: true };
  }
}

@Global()
@Module({
  controllers: [SessionController],
  providers: [SecurityService, AdminGuard, DeviceGuard],
  exports: [SecurityService, AdminGuard, DeviceGuard],
})
export class SecurityModule {}
