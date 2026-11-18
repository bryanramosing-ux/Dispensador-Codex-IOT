import { Config, edgeUrl, localIp } from '../src/config/config';
import { decodeCursor, encodeCursor, LocalStore } from '../src/persistence/local-store';
import { remove, scratch } from './support';
import { importRow } from '../src/persistence/import-legacy';

describe('fronteras y almacenamiento local', () => {
  it('solo acepta IPv4 de LAN, sin URL arbitraria, redirección ni hostname', () => {
    expect(localIp('172.31.255.254')).toBe(true);
    expect(localIp('172.32.0.1')).toBe(false);
    expect(edgeUrl('http://192.168.1.51:80/')).toBe('http://192.168.1.51');
    for (const url of [
      'http://169.254.169.254',
      'http://localhost',
      'http://user@10.0.0.1',
      'http://10.0.0.1/status',
      'http://10.0.0.1/?foo=1',
      'ftp://10.0.0.1',
    ]) {
      expect(() => edgeUrl(url)).toThrow();
    }
  });

  it('valida cursores de fecha y desempate sin datos adicionales', () => {
    const cursor = { id: '00000000000007', at: 1777111111000 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    for (const at of [-1, 1.5, Number.MAX_VALUE])
      expect(decodeCursor(encodeCursor({ ...cursor, at }))).toBeUndefined();
    expect(decodeCursor(encodeCursor({ ...cursor, id: 'a/b' }))).toBeUndefined();
  });

  it('revierte proyección y cola de forma atómica y bloquea una segunda instancia', () => {
    const dir = scratch(),
      cfg = { storageDir: dir } as Config;
    const store = new LocalStore(cfg);
    try {
      expect(() => new LocalStore(cfg)).toThrow('STORAGE_DIR ya está en uso');
      expect(() =>
        store.atomic((tx) => {
          tx.set('settings', 'dashboard', 1, { auto_capture_s: 30 });
          throw new Error('fallo local simulado');
        }),
      ).toThrow('fallo local');
      expect(store.get('settings', 'dashboard')).toBeUndefined();
      expect(store.pendingCount()).toBe(0);
      store.atomic((tx) => tx.set('settings', 'dashboard', 1, { auto_capture_s: 30 }));
      expect(store.pendingCount()).toBe(1);
    } finally {
      store.onModuleDestroy();
      remove(dir);
    }
  });
});

it('importa IDs y fechas de Python una sola vez, conserva JPEG y reserva el siguiente ID', () => {
  const dir = scratch(),
    store = new LocalStore({ storageDir: dir } as Config);
  try {
    const event = {
      kind: 'event',
      id: 42,
      ts: '2026-11-15T20:05:00+00:00',
      tipo: 'dispensacion',
      mensaje: 'Python',
      dato: null,
    };
    const name = 'foto_20261115_200500_a0b1c2.jpg';
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(importRow(store, event)).toBe(true);
    expect(importRow(store, event)).toBe(false);
    expect(importRow(store, { kind: 'photo', name, ts: event.ts, jpeg: jpeg.toString('base64') })).toBe(true);
    expect(importRow(store, { kind: 'settings', auto_capture_s: 60 })).toBe(true);
    expect(store.page('history', 5).items).toEqual([
      { id: 42, ts: event.ts, tipo: 'dispensacion', mensaje: 'Python' },
    ]);
    expect(store.jpeg(name)).toEqual(jpeg);
    expect(store.atomic((tx) => tx.next('history'))).toBe(43);
  } finally {
    store.onModuleDestroy();
    remove(dir);
  }
});
