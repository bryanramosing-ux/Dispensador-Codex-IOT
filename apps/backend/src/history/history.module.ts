import { Controller, Get, Global, Module, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { HistoryService } from './history.service';
import { AdminGuard } from '../security/security';
import { decodeCursor } from '../persistence/local-store';
import { fail } from '../config/http';

export function pageLimit(input: unknown, fallback: number) {
  if (typeof input !== 'string' || !/^[+-]?\d+$/.test(input.trim())) return fallback;
  return Math.max(1, Math.min(500, Number(input)));
}
export function pageCursor(input: unknown) {
  const cursor = decodeCursor(input);
  if (input !== undefined && !cursor) fail(400, 'cursor inválido');
  return cursor;
}

@Controller('api/history')
@UseGuards(AdminGuard)
class HistoryController {
  constructor(private readonly history: HistoryService) {}
  @Get()
  list(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const { items, next } = this.history.page(
      pageLimit(query.limit, 100),
      pageCursor(query.cursor),
      typeof query.tipo === 'string' ? query.tipo : undefined,
    );
    if (next) res.setHeader('X-Next-Cursor', next);
    return { items };
  }
}

@Global()
@Module({ providers: [HistoryService], controllers: [HistoryController], exports: [HistoryService] })
export class HistoryModule {}
