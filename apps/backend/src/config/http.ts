import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger, PipeTransform } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ZodType } from 'zod';

export const MAX_JSON = 8192;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validKeys(data: JsonObject) {
  return Object.keys(data).every((key) => key && Buffer.byteLength(key) <= 1500 && !/^__.*__$/.test(key));
}

export function edgeObject(value: unknown): value is JsonObject {
  return (
    isObject(value) &&
    validKeys(value) &&
    Object.values(value).every(
      (item) =>
        item === null ||
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)),
    )
  );
}

export function utc(ms = Date.now()) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function fail(status: number, error: string, okField = true): never {
  throw new HttpException(okField ? { ok: false, error } : { error }, status);
}

export class DtoPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodType,
    private readonly onError: (body: JsonObject) => string,
    private readonly integerField?: string,
  ) {}
  transform(raw: Buffer | undefined) {
    if (!raw?.length) fail(400, 'JSON inválido');
    let body: unknown;
    try {
      body = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(raw),
        (key, value, context?: { source?: string }) => {
          // Preserve Python's distinction between integer literals and floats such as 1.0.
          if (
            key === this.integerField &&
            typeof value === 'number' &&
            !/^-?\d+$/.test(context?.source ?? '')
          ) {
            return context?.source;
          }
          return value;
        },
      );
    } catch {
      fail(400, 'JSON inválido');
    }
    if (!isObject(body)) fail(400, 'se esperaba un objeto JSON');
    const parsed = this.schema.safeParse(body);
    if (!parsed.success) fail(400, this.onError(body));
    return parsed.data;
  }
}

@Catch()
export class HttpErrors implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrors.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (exception instanceof HttpException) {
      const code = exception.getStatus();
      const value = exception.getResponse();
      if (code === 404 && typeof value === 'object' && ('message' in value || !('error' in value))) {
        res.status(404).json({ error: 'ruta no encontrada' });
        return;
      }
      res.status(code).json(typeof value === 'string' ? { error: value } : value);
      return;
    }
    const status = (exception as { status?: number } | null)?.status;
    if (status === 413 || status === 415 || status === 400) {
      res.status(status === 415 ? 400 : status).json({
        ok: false,
        error: status === 413 ? 'cuerpo demasiado grande o inválido' : 'JSON inválido',
      });
      return;
    }
    this.logger.error(
      'Error interno HTTP ' +
        ctx.getRequest<Request>().method +
        ' (' +
        (exception instanceof Error ? exception.name : typeof exception) +
        ')',
    );
    res.status(500).json({ ok: false, error: 'error interno' });
  }
}
