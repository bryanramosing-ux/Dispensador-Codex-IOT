import { Injectable } from '@nestjs/common';
import { SseService } from '../events/sse.service';
import { type JsonObject, utc } from '../config/http';
import { LocalStore, LocalTransaction, type Cursor } from '../persistence/local-store';

export type EventType = 'conexion' | 'estado' | 'error' | 'dispensacion' | 'alerta' | 'foto';
export type HistoryEntry = { id: number; ts: string; tipo: EventType; mensaje: string };
type Append = (type: EventType, message: string, details?: JsonObject) => void;

@Injectable()
export class HistoryService {
  constructor(
    private readonly local: LocalStore,
    private readonly sse: SseService,
  ) {}

  atomic<T>(work: (tx: LocalTransaction, add: Append) => T, at = Date.now()) {
    const events: HistoryEntry[] = [];
    const result = this.local.atomic((tx) =>
      work(tx, (type, message, details) => {
        const entry = { id: tx.next('history'), ts: utc(at), tipo: type, mensaje: message };
        const key = String(entry.id).padStart(14, '0');
        tx.set('history', key, at, entry);
        tx.set('events', key, at, { ...entry, detalle: details ?? null });
        events.push(entry);
      }),
    );
    for (const { ts, tipo, mensaje } of events) this.sse.publish('evento', { ts, tipo, mensaje });
    return result;
  }

  log(type: EventType, message: string, details?: JsonObject) {
    this.atomic((_tx, add) => add(type, message, details));
  }
  page(limit: number, before?: Cursor, type?: string) {
    return this.local.page<HistoryEntry>('history', limit, before, type);
  }
}
