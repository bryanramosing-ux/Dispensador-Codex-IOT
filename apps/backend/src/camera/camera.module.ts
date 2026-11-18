import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { DtoPipe, fail } from '../config/http';
import { DevicesModule } from '../devices/devices.module';
import type { Photo } from '../devices/devices.service';
import { HistoryService } from '../history/history.service';
import { pageCursor, pageLimit } from '../history/history.module';
import { LocalStore } from '../persistence/local-store';
import { AdminGuard, SecurityService } from '../security/security';
import { CameraService, PHOTO_NAME } from './camera.service';

const interval = new DtoPipe(
  z.object({
    interval_s: z
      .number()
      .int()
      .refine((n) => n === 0 || (n >= 10 && n <= 3600)),
  }),
  () => 'interval_s debe ser 0 (apagado) o 10-3600',
  'interval_s',
);

@Controller('api')
@UseGuards(AdminGuard)
class CameraController {
  constructor(
    private readonly camera: CameraService,
    private readonly store: LocalStore,
    private readonly security: SecurityService,
    private readonly history: HistoryService,
  ) {}

  @Get('gallery')
  gallery(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const { items, next } = this.store.page<Photo>(
      'photos',
      pageLimit(query.limit, 500),
      pageCursor(query.cursor),
    );
    if (next) res.setHeader('X-Next-Cursor', next);
    return { items };
  }

  @Get('gallery/:name')
  photo(@Param('name') name: string, @Query('download') download: string, @Res() res: Response) {
    if (!PHOTO_NAME.test(name) || !this.store.get<Photo>('photos', name))
      fail(404, 'foto no encontrada', false);
    const bytes = this.store.jpeg(name);
    if (!bytes) fail(404, 'foto no encontrada', false);
    res.set(
      'Content-Disposition',
      (download === '1' ? 'attachment' : 'inline') + '; filename="' + name + '"',
    );
    res.type('image/jpeg').send(bytes);
  }

  @Delete('gallery/:name')
  delete(@Param('name') name: string, @Req() req: Request) {
    if (req.get('X-Confirm') !== 'delete') fail(400, 'falta confirmación de borrado');
    this.camera.delete(name);
    return { ok: true, deleted: name };
  }

  @Get('camera/frame')
  async frame(@Res() res: Response) {
    res.type('image/jpeg').send(await this.camera.frame());
  }

  @Get('camera/stream')
  stream(@Req() req: Request, @Res() res: Response) {
    this.camera.stream(res, () => this.security.authenticated(req));
  }

  @Post('camera/refresh')
  @HttpCode(200)
  async refresh() {
    return { ok: true, online: await this.camera.poll() };
  }

  @Post('capture')
  @HttpCode(200)
  async capture() {
    try {
      return { ok: true, ...(await this.camera.capture('manual')) };
    } catch (error) {
      this.history.log('error', 'Captura fallida');
      if (!(error instanceof HttpException)) throw error;
      const body = error.getResponse() as { error: string };
      return fail(503, 'no se pudo capturar: ' + body.error);
    }
  }

  @Post('auto-capture')
  @HttpCode(200)
  auto(@Body(interval) { interval_s }: { interval_s: number }) {
    this.camera.setAuto(interval_s);
    return { ok: true, auto_capture_s: interval_s };
  }
}

@Module({ imports: [DevicesModule], providers: [CameraService], controllers: [CameraController] })
export class CameraModule {}
