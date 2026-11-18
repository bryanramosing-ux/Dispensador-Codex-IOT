import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { Config } from '../config/config';
import { isObject, utc } from '../config/http';
import { MAX_PHOTO } from '../devices/edge-http';
import { LocalStore } from './local-store';

const iso = z.string().refine((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) >= 0);
const rowSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('event'),
    id: z.number().int().positive().max(99999999999999),
    ts: iso,
    tipo: z.string().min(1).max(32),
    mensaje: z.string().max(8192),
    dato: z.unknown(),
  }),
  z.object({
    kind: z.literal('settings'),
    auto_capture_s: z
      .number()
      .int()
      .refine((n) => n === 0 || (n >= 10 && n <= 3600)),
  }),
  z.object({
    kind: z.literal('photo'),
    name: z.string().regex(/^foto_\d{8}_\d{6}_[0-9a-f]{6}\.jpg$/),
    ts: iso,
    jpeg: z.string().max(Math.ceil(MAX_PHOTO / 3) * 4),
  }),
]);

export function importRow(store: LocalStore, item: unknown) {
  const row = rowSchema.parse(item);
  return store.atomic((tx) => {
    const ts = 'ts' in row ? Date.parse(row.ts) : Date.now();
    switch (row.kind) {
      case 'event': {
        if (!tx.markOnce('source-event:' + row.id)) return false;
        const key = String(row.id).padStart(14, '0');
        if (store.get('history', key)) throw new Error('ID de historial ocupado: ' + row.id);
        const event = { id: row.id, ts: utc(ts), tipo: row.tipo, mensaje: row.mensaje };
        tx.reserve('history', row.id);
        tx.set('history', key, ts, event);
        tx.set('events', key, ts, { ...event, detalle: isObject(row.dato) ? row.dato : null });
        return true;
      }
      case 'settings':
        if (!tx.markOnce('source-settings')) return false;
        if (store.get('settings', 'dashboard')) throw new Error('Ya existe configuración del dashboard');
        tx.set('settings', 'dashboard', ts, { auto_capture_s: row.auto_capture_s });
        return true;
      case 'photo': {
        if (!tx.markOnce('source-photo:' + row.name)) return false;
        const bytes = Buffer.from(row.jpeg, 'base64');
        if (bytes.length > MAX_PHOTO || bytes[0] !== 0xff || bytes[1] !== 0xd8)
          throw new Error('JPEG de origen inválido');
        tx.putPhoto(row.name, bytes);
        tx.set('photos', row.name, ts, { name: row.name, size: bytes.length, ts: utc(ts) });
        return true;
      }
    }
  });
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Uso: npm run import:legacy -- /ruta/backend/storage');
  const store = new LocalStore(new Config());
  try {
    const script = resolve(__dirname, '../../../../scripts/legacy/export-storage.py');
    const child = spawn('python3', [script, process.argv[2]], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exit = once(child, 'close');
    // Attach immediately so an unavailable Python executable is handled while waiting for stdout.
    void exit.catch(() => undefined);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let imported = 0,
      skipped = 0;
    try {
      for await (const line of lines) {
        if (importRow(store, JSON.parse(line))) imported++;
        else skipped++;
      }
      const [code] = await exit;
      if (code !== 0) throw new Error('exportación Python incompleta (código ' + code + ')');
      console.log('Importados: ' + imported + '; ya presentes: ' + skipped);
    } finally {
      lines.close();
      child.kill();
    }
  } finally {
    store.onModuleDestroy();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(
      'Importación detenida: ' +
        (error instanceof z.ZodError ? 'registro inválido' : (error as Error).message),
    );
    process.exitCode = 1;
  });
}
