import { Injectable, Logger, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldPath, Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHash, randomUUID } from 'node:crypto';
import { Config } from '../config/config';
import { LocalStore, type Collection, type Cursor, type PendingWrite } from './local-store';

@Injectable()
export class FirestoreService implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly app;
  readonly db: Firestore;
  private readonly logger = new Logger(FirestoreService.name);
  private timer?: NodeJS.Timeout;
  private active = false;
  private stopped = false;
  private failures = 0;
  private nextAttempt = 0;
  lastSyncedAt: number | null = null;

  constructor(
    private readonly config: Config,
    private readonly local: LocalStore,
  ) {
    const { FIREBASE_PROJECT_ID: projectId, FIREBASE_STORAGE_BUCKET: storageBucket } = config.env;
    this.app = initializeApp(
      {
        projectId,
        ...(storageBucket && { storageBucket }),
        ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
      },
      randomUUID(),
    );
    this.db = getFirestore(this.app);
  }

  onModuleInit() {
    if (!this.config.test) this.timer = setInterval(() => void this.drain(), 350);
  }

  onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
  }
  async onApplicationShutdown() {
    await deleteApp(this.app);
  }

  async drain(now = Date.now()) {
    if (this.active || this.stopped || now < this.nextAttempt) return;
    this.active = true;
    try {
      for (let index = 0; index < 25 && !this.stopped; index++) {
        const entry = this.local.pending();
        if (!entry) return;
        await this.commit(entry);
        if (this.stopped) return;
        this.local.complete(entry);
        this.lastSyncedAt = Date.now();
        this.failures = 0;
        this.nextAttempt = 0;
      }
    } catch (error) {
      if (this.stopped) return;
      const delay = Math.min(60000, 500 * 2 ** Math.min(this.failures++, 7));
      this.nextAttempt = Date.now() + delay + Math.floor(Math.random() * 250);
      const code = (error as { code?: unknown } | null)?.code;
      this.logger.warn(
        'Sincronización pendiente; reintento en ' +
          delay +
          ' ms' +
          (Number.isInteger(code) ? ' (código ' + code + ')' : ''),
      );
    } finally {
      this.active = false;
    }
  }

  async commit(entry: PendingWrite) {
    const bucket = this.config.env.FIREBASE_STORAGE_BUCKET ? getStorage(this.app).bucket() : undefined;
    const marker = this.db.collection('settings').doc('_sync-' + this.local.instanceId);
    if (bucket && entry.photo) {
      const applied = (await marker.get()).get('seq') as number | undefined;
      if (applied && applied >= entry.seq) return;
      bucket.storage.retryOptions.totalTimeout = 20;
      bucket.storage.retryOptions.maxRetries = 2;
      const object = bucket.file('gallery/' + entry.photo.name);
      if (entry.photo.action === 'upload') {
        const bytes = this.local.jpeg(entry.photo.name);
        if (!bytes) throw new Error('JPEG de la cola ausente');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        try {
          await object.save(bytes, {
            resumable: false,
            timeout: 10000,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: 'image/jpeg', metadata: { sha256 } },
          });
        } catch (error) {
          if ((error as { code?: number }).code !== 412) throw error;
          const [metadata] = await object.getMetadata();
          if (metadata.metadata?.sha256 !== sha256) throw new Error('el objeto ya existe con otro contenido');
        }
      } else {
        await object.delete({ ignoreNotFound: true });
      }
    }
    await this.db.runTransaction(
      async (tx) => {
        const applied = (await tx.get(marker)).get('seq') as number | undefined;
        if (applied && applied >= entry.seq) return;
        for (const doc of entry.docs) {
          const ref = this.db.collection(doc.collection).doc(doc.id);
          if (doc.data === null) tx.delete(ref);
          else
            tx.set(ref, {
              ...doc.data,
              recordedAt: Timestamp.fromMillis(doc.at),
              ...(doc.collection === 'photos' && { objectPath: bucket ? 'gallery/' + doc.id : null }),
            });
        }
        tx.set(marker, { seq: entry.seq, syncedAt: Timestamp.now() });
      },
      { maxAttempts: 3 },
    );
  }

  async page(collection: Collection, limit: number, cursor?: Cursor, type?: string) {
    let query: FirebaseFirestore.Query = this.db.collection(collection);
    if (type) query = query.where('tipo', '==', type);
    query = query.orderBy('recordedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (cursor) query = query.startAfter(Timestamp.fromMillis(cursor.at), cursor.id);
    const result = await query.limit(limit).get();
    return result.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }
}
