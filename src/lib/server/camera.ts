import 'server-only';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { COMMAND_TTL_SECONDS, captureInterval, deviceOnline, photoName, type Photo } from '@/lib/contracts';
import { db, bucket } from './firebase';
import { HttpError } from './http';
import { broker } from './mqtt';
import { addHistory } from './store';

export const photosEnabled = () => Boolean(process.env.FIREBASE_STORAGE_BUCKET);

const state = globalThis as typeof globalThis & {
  dispenserFrame?: Promise<Buffer>;
  dispenserAutoStarted?: boolean;
};

async function readFrame() {
  const mqtt = broker();
  if (!mqtt?.ready) throw new HttpError(503, 'El broker MQTT no está disponible.');
  const status = await db().collection('device_status').doc('camera').get();
  if (!deviceOnline(status.get('seen'), 'camera', Date.now()) || status.get('data.camara') !== true) {
    throw new HttpError(503, 'La cámara no está lista.');
  }
  const frame = await mqtt.frame(randomUUID(), Math.floor(Date.now() / 1000) + COMMAND_TTL_SECONDS);
  if (!frame) throw new HttpError(504, 'La cámara no respondió con una imagen.');
  return frame;
}

export function frame() {
  state.dispenserFrame ??= readFrame().finally(() => { state.dispenserFrame = undefined; });
  return state.dispenserFrame;
}

export async function capture(source: 'manual' | 'auto'): Promise<Photo> {
  if (!photosEnabled()) throw new HttpError(503, 'Configura Cloud Storage para guardar fotos.');
  const bytes = await frame();
  const recordedAt = Timestamp.now();
  const ts = recordedAt.toDate().toISOString();
  const [date, time] = ts.split('T');
  const name = 'foto_' + date.replaceAll('-', '') + '_' + time.slice(0, 8).replaceAll(':', '') +
    '_' + randomUUID().replaceAll('-', '') + '.jpg';
  const photo = { name, ts, size: bytes.length };
  const objectPath = 'gallery/' + name;
  const object = bucket().file(objectPath);
  await object.save(bytes, {
    resumable: false,
    metadata: { contentType: 'image/jpeg' },
    preconditionOpts: { ifGenerationMatch: 0 },
  });
  const database = db();
  const photoRef = database.collection('photos').doc(name);
  const batch = database.batch();
  batch.create(photoRef, { ...photo, recordedAt, objectPath, source });
  addHistory(batch, 'captura', 'Foto guardada · ' + (source === 'auto' ? 'automática' : 'manual'), recordedAt.toMillis(), { name });
  try {
    await batch.commit();
  } catch (error) {
    // A lost response can follow a successful commit. Check before removing the object.
    const persisted = await photoRef.get().catch(() => undefined);
    if (persisted?.exists) return photo;
    if (persisted) await object.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
  return photo;
}

export async function galleryObject(name: string) {
  if (!photoName.test(name) || !photosEnabled()) throw new HttpError(404, 'No se encontró la foto.');
  const ref = db().collection('photos').doc(name);
  const photo = await ref.get();
  if (photo.get('objectPath') !== 'gallery/' + name) throw new HttpError(404, 'No se encontró la foto.');
  return { ref, file: bucket().file('gallery/' + name) };
}

export async function changeInterval(seconds: number) {
  if (seconds && !photosEnabled()) throw new HttpError(503, 'Configura Cloud Storage para guardar fotos.');
  await db().collection('settings').doc('dashboard').set({ auto_capture_s: seconds }, { merge: true });
}

export function startAutoCapture() {
  if (state.dispenserAutoStarted || !process.env.FIREBASE_PROJECT_ID || !photosEnabled() || !broker()) return;
  state.dispenserAutoStarted = true;
  let interval = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  function schedule() {
    clearTimeout(timer);
    if (interval <= 0 || running) return;
    timer = setTimeout(async () => {
      running = true;
      try {
        if (broker()?.ready) await capture('auto');
      } catch (error) {
        console.warn('Captura automática fallida', (error as { code?: unknown })?.code ?? (error as Error)?.name);
      } finally {
        running = false;
        schedule();
      }
    }, interval * 1000);
    timer.unref();
  }

  db().collection('settings').doc('dashboard').onSnapshot((snapshot) => {
    const parsed = captureInterval.safeParse({ interval_s: snapshot.get('auto_capture_s') });
    const updated = parsed.data?.interval_s ?? 0;
    if (updated === interval) return;
    interval = updated;
    schedule();
  }, (error) => {
    interval = 0;
    clearTimeout(timer);
    console.error('No se pudo observar la captura automática', (error as { code?: unknown }).code ?? error.name);
    state.dispenserAutoStarted = false;
    const retry = setTimeout(startAutoCapture, 30_000);
    retry.unref();
  });
}
