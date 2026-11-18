import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Config } from '../config/config';
import type { JsonObject } from '../config/http';

export type Collection =
  'telemetry' | 'device_status' | 'history' | 'events' | 'commands' | 'photos' | 'settings';
export type Doc = { collection: Collection; id: string; at: number; data: JsonObject | null };
export type PhotoChange = { name: string; action: 'upload' | 'delete' };
export type PendingWrite = { seq: number; docs: Doc[]; photo?: PhotoChange };
type Row = { id: string; at: number; body: string };
export interface Cursor {
  at: number;
  id: string;
}

export function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(value: unknown): Cursor | undefined {
  if (typeof value !== 'string' || !/^[\w-]{1,250}$/.test(value)) return undefined;
  try {
    const { at, id } = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
    if (Number.isSafeInteger(at) && at >= 0 && typeof id === 'string' && /^[\w.-]{1,100}$/.test(id))
      return { at, id };
  } catch {
    return undefined;
  }
  return undefined;
}

@Injectable()
export class LocalStore implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  private readonly lock: DatabaseSync;
  readonly instanceId: string;

  constructor(config: Config) {
    mkdirSync(config.storageDir, { recursive: true, mode: 0o700 });
    this.lock = new DatabaseSync(join(config.storageDir, 'instance.db'));
    try {
      this.lock.exec('BEGIN EXCLUSIVE');
    } catch {
      this.lock.close();
      throw new Error('STORAGE_DIR ya está en uso por otro proceso');
    }
    this.db = new DatabaseSync(join(config.storageDir, 'edge.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 500;
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS docs_by_date ON docs(collection, at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS history_by_type ON docs(collection, json_extract(body,'$.tipo'), at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ids (kind TEXT PRIMARY KEY, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jpeg (id TEXT PRIMARY KEY, bytes BLOB NOT NULL);
    `);
    this.db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES ('instance',?)").run(randomUUID());
    this.instanceId = this.db.prepare("SELECT value FROM metadata WHERE key='instance'").get()
      ?.value as string;
  }

  onModuleDestroy() {
    this.db.close();
    this.lock.close();
  }
  get<T>(collection: Collection, id: string): T | undefined {
    const row = this.db.prepare('SELECT body FROM docs WHERE collection=? AND id=?').get(collection, id);
    return row ? (JSON.parse(row.body as string) as T) : undefined;
  }

  page<T>(collection: Collection, limit: number, before?: Cursor, type?: string) {
    const rows = this.db
      .prepare(
        `
      SELECT id, at, body FROM docs WHERE collection=?
      ${type ? "AND json_extract(body,'$.tipo')=?" : ''}
      ${before ? 'AND (at,id) < (?,?)' : ''}
      ORDER BY at DESC, id DESC LIMIT ?
    `,
      )
      .all(
        collection,
        ...(type ? [type] : []),
        ...(before ? [before.at, before.id] : []),
        limit + 1,
      ) as unknown as Row[];
    const items = rows.slice(0, limit).map((row) => JSON.parse(row.body) as T);
    return {
      items,
      next: rows.length > limit ? encodeCursor({ at: rows[limit - 1].at, id: rows[limit - 1].id }) : null,
    };
  }

  interruptedCommands<T>() {
    const rows = this.db
      .prepare(
        "SELECT id,body FROM docs WHERE collection='commands' AND json_extract(body,'$.state')='dispatching'",
      )
      .all();
    return rows.map((row) => ({ id: row.id as string, command: JSON.parse(row.body as string) as T }));
  }

  jpeg(name: string) {
    const row = this.db.prepare('SELECT bytes FROM jpeg WHERE id=?').get(name);
    return row ? Buffer.from(row.bytes as Uint8Array) : undefined;
  }

  atomic<T>(work: (tx: LocalTransaction) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const tx = new LocalTransaction(this.db);
      const result = work(tx);
      if (tx.docs.length) {
        this.db
          .prepare('INSERT INTO outbox(body) VALUES (?)')
          .run(JSON.stringify({ docs: tx.docs, photo: tx.photo }));
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  pending(): PendingWrite | undefined {
    const row = this.db.prepare('SELECT seq, body FROM outbox ORDER BY seq LIMIT 1').get();
    return row ? { seq: Number(row.seq), ...JSON.parse(row.body as string) } : undefined;
  }

  pendingCount() {
    return (this.db.prepare('SELECT count(*) AS count FROM outbox').get()?.count ?? 0) as number;
  }

  complete(entry: PendingWrite) {
    this.atomic(() => {
      if (entry.photo?.action === 'delete')
        this.db.prepare('DELETE FROM jpeg WHERE id=?').run(entry.photo.name);
      this.db.prepare('DELETE FROM outbox WHERE seq=?').run(entry.seq);
    });
  }
}

export class LocalTransaction {
  readonly docs: Doc[] = [];
  photo?: PhotoChange;
  constructor(private readonly db: DatabaseSync) {}

  set(collection: Collection, id: string, at: number, data: JsonObject) {
    this.db
      .prepare(
        `
      INSERT INTO docs(collection,id,at,body) VALUES (?,?,?,?)
      ON CONFLICT(collection,id) DO UPDATE SET at=excluded.at, body=excluded.body
    `,
      )
      .run(collection, id, at, JSON.stringify(data));
    this.docs.push({ collection, id, at, data });
  }

  delete(collection: Collection, id: string) {
    this.db.prepare('DELETE FROM docs WHERE collection=? AND id=?').run(collection, id);
    this.docs.push({ collection, id, at: Date.now(), data: null });
  }

  next(kind: string) {
    const row = this.db
      .prepare(
        `
      INSERT INTO ids(kind,count) VALUES (?,1)
      ON CONFLICT(kind) DO UPDATE SET count=count+1 RETURNING count
    `,
      )
      .get(kind);
    return Number(row?.count);
  }

  reserve(kind: string, count: number) {
    this.db
      .prepare(
        `
      INSERT INTO ids(kind,count) VALUES (?,?)
      ON CONFLICT(kind) DO UPDATE SET count=max(count,excluded.count)
    `,
      )
      .run(kind, count);
  }

  markOnce(key: string) {
    return this.db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES (?,'1')").run(key).changes > 0;
  }

  putPhoto(id: string, bytes: Buffer) {
    this.db.prepare('INSERT INTO jpeg(id,bytes) VALUES (?,?)').run(id, bytes);
    this.photo = { action: 'upload', name: id };
  }

  deletePhoto(id: string) {
    this.delete('photos', id);
    this.photo = { action: 'delete', name: id };
  }
}
