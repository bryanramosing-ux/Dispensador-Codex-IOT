import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type Request, type Response, type NextFunction } from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { Config } from './config/config';
import { HttpErrors, MAX_JSON } from './config/http';
import { SecurityService } from './security/security';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    abortOnError: false,
    logger: process.env.NODE_ENV === 'test' ? false : undefined,
  });
  const config = app.get(Config);
  const security = app.get(SecurityService);
  app.disable('x-powered-by');
  app.useGlobalFilters(new HttpErrors());
  app.use(security.middleware.bind(security));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.get('origin');
    if (origin && security.originAllowed(req, origin) && config.origins.has(origin)) {
      res.vary('Origin');
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With, X-Confirm, Idempotency-Key',
        'Access-Control-Expose-Headers': 'X-Next-Cursor',
      });
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });
  const raw = express.raw({ type: () => true, limit: MAX_JSON, inflate: false });
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    raw(req, res, (error?: { status?: number }) => {
      if (!error) {
        next();
        return;
      }
      const tooLarge = error.status === 413;
      res
        .status(tooLarge ? 413 : 400)
        .json({ ok: false, error: tooLarge ? 'cuerpo demasiado grande o inválido' : 'JSON inválido' });
    });
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const files: Record<string, string> = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/app.js': 'app.js',
      '/styles.css': 'styles.css',
    };
    const name = files[req.path];
    if (!name || !Object.hasOwn(files, req.path)) {
      next();
      return;
    }
    res.sendFile(join(config.frontendDir, name), { cacheControl: false }, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'archivo no encontrado' });
    });
  });
  const server = app.getHttpServer();
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const { env } = app.get(Config);
  app.enableShutdownHooks();
  await app.listen(env.PORT, env.HOST);
}

if (require.main === module) {
  void bootstrap().catch((error) => {
    console.error(
      'No se pudo iniciar NestJS (' + (error instanceof Error ? error.message : 'error interno') + ')',
    );
    process.exitCode = 1;
  });
}
