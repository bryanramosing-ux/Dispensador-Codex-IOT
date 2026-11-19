import 'server-only';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { COMMAND_TTL_SECONDS, captureInterval, deviceOnline, isJpeg, photoName, type Photo } from '@/lib/contracts';
import { db } from './firebase';
import { HttpError } from './http';
import { broker } from './mqtt';
import { addHistory } from './store';

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
  const bytes = await frame();
  const recordedAt = Timestamp.now();
  const ts = recordedAt.toDate().toISOString();
  const [date, time] = ts.split('T');
  const name = 'foto_' + date.replaceAll('-', '') + '_' + time.slice(0, 8).replaceAll(':', '') +
    '_' + randomUUID().replaceAll('-', '') + '.jpg';
  const photo = { name, ts, size: bytes.length };
  const { database, metadata, image } = photoRefs(name);
  const batch = database.batch();
  batch.create(metadata, { ...photo, recordedAt, source });
  batch.create(image, { bytes });
  addHistory(batch, 'captura', 'Foto guardada · ' + (source === 'auto' ? 'automática' : 'manual'), recordedAt.toMillis(), { name });
  await batch.commit();
  return photo;
}

function photoRefs(name: string) {
  if (!photoName.test(name)) throw new HttpError(404, 'No se encontró la foto.');
  const database = db();
  return {
    database,
    metadata: database.collection('photos').doc(name),
    image: database.collection('photo_images').doc(name),
  };
}

function requirePhoto(metadata: FirebaseFirestore.DocumentSnapshot, image: FirebaseFirestore.DocumentSnapshot) {
  if (!metadata.exists) throw new HttpError(404, 'No se encontró la foto.');
  if (!image.exists && metadata.get('objectPath')) {
    throw new HttpError(409, 'Esta captura antigua requiere recuperar su JPEG e importarlo a Firestore.');
  }
  if (!image.exists) throw new HttpError(404, 'No se encontró la imagen.');
}

export async function galleryBytes(name: string) {
  const { database, metadata, image } = photoRefs(name);
  const [photo, file] = await database.getAll(metadata, image);
  requirePhoto(photo, file);
  const bytes: unknown = file.get('bytes');
  if (!(bytes instanceof Uint8Array) || !isJpeg(bytes)) throw new HttpError(404, 'La imagen guardada es inválida.');
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

export async function deletePhoto(name: string) {
  const { database, metadata, image } = photoRefs(name);
  await database.runTransaction(async (tx) => {
    const [photo, file] = await tx.getAll(metadata, image);
    requirePhoto(photo, file);
    tx.delete(metadata);
    tx.delete(image);
  });
}

export async function changeInterval(seconds: number) {
  await db().collection('settings').doc('dashboard').set({ auto_capture_s: seconds }, { merge: true });
}

export function startAutoCapture() {
  if (state.dispenserAutoStarted || !process.env.FIREBASE_PROJECT_ID || !broker()) return;
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
