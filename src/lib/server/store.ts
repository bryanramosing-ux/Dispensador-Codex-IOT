import 'server-only';
import { FieldPath, Timestamp, type Query, type DocumentReference, type DocumentData } from 'firebase-admin/firestore';
import { alertData, cameraData, deviceOnline, dispenserData, type CameraData, type DeviceStatus, type DispenserData, type HistoryEntry, type Page, type Photo } from '@/lib/contracts';
import { z } from 'zod';
import { db } from './firebase';
import { HttpError } from './http';

type Kind = 'esp32' | 'camera';
type Sample = { sentAt: number; data: DispenserData | CameraData };

export function addHistory(writer: { set(ref: DocumentReference, data: DocumentData): unknown }, tipo: string, mensaje: string, at: number, detail?: object) {
  writer.set(db().collection('history').doc(), {
    tipo, mensaje, ts: new Date(at).toISOString(), recordedAt: Timestamp.fromMillis(at),
    ...(detail && { detail }),
  });
}

export async function storeSample(kind: Kind, sample: Sample, seen: number) {
  const database = db();
  const ref = database.collection('device_status').doc(kind);
  await database.runTransaction(async (tx) => {
    const previous = await tx.get(ref);
    const priorTime = previous.get('sentAt') as number | undefined;
    if (priorTime !== undefined && priorTime > sample.sentAt) return;
    const recordedAt = Timestamp.fromMillis(seen);
    tx.set(ref, { ...sample, seen, recordedAt });

    if (!deviceOnline(previous.get('seen'), kind, seen)) {
      addHistory(tx, 'conexion', kind === 'esp32' ? 'ESP32 conectado' : 'ESP32-CAM conectada', seen);
    }
    if (kind !== 'esp32') return;

    const before = dispenserData.safeParse(previous.get('data')).data;
    const data = sample.data as DispenserData;
    tx.create(database.collection('telemetry').doc(), {
      deviceId: kind, ts: new Date(seen).toISOString(), recordedAt,
      payload: data, sentAt: sample.sentAt,
    });
    if (before?.estado !== data.estado) {
      addHistory(tx, 'estado', 'ESP32: ' + (before?.estado ?? '—') + ' → ' + data.estado, seen);
    }
    if (data.error && before?.error !== data.error) {
      addHistory(tx, 'error', 'ESP32: ' + data.error, seen);
    }
    if (before && data.dispensaciones_total !== undefined && data.dispensaciones_total !== before.dispensaciones_total) {
      addHistory(tx, 'dispensacion', 'Dispensación #' + data.dispensaciones_total +
        ' · ' + (data.ultimo_origen ?? 'Origen desconocido') +
        ' · ' + (data.ultimas_porciones ?? '—') + ' porc. · ' + (data.ultimo_resultado ?? '—'), seen);
    }
  });
}

export async function storeAlert(data: z.infer<typeof alertData>, at: number) {
  const database = db();
  const marker = database.collection('settings').doc('last-mqtt-alert');
  await database.runTransaction(async (tx) => {
    const previous = await tx.get(marker);
    if (previous.get('tipo') === data.tipo && previous.get('nivel') === data.nivel && at - previous.get('at') < 35_000) return;
    tx.set(marker, { ...data, at });
    addHistory(tx, 'alerta', 'Tolva: ' + data.tipo + ' · ' + data.nivel + ' %', at, data);
  });
}

function serializeStatus<T>(snap: FirebaseFirestore.DocumentSnapshot, kind: Kind, schema: z.ZodType<T>, now: number): DeviceStatus<T> {
  const seen = snap.get('seen');
  return {
    seen: typeof seen === 'number' ? seen : null,
    online: deviceOnline(seen, kind, now),
    data: schema.safeParse(snap.get('data')).data ?? null,
  };
}

export async function dashboard() {
  const database = db();
  const [esp32, camera, settings] = await database.getAll(
    database.collection('device_status').doc('esp32'),
    database.collection('device_status').doc('camera'),
    database.collection('settings').doc('dashboard'),
  );
  const now = Date.now();
  return {
    esp32: serializeStatus(esp32, 'esp32', dispenserData, now),
    camera: serializeStatus(camera, 'camera', cameraData, now),
    autoCapture: (settings.get('auto_capture_s') as number | undefined) ?? 0,
  };
}

const cursorSchema = z.tuple([z.number().int().nonnegative(), z.string().min(1).max(128).regex(/^[^/]+$/)]);

export async function list<T extends Photo | HistoryEntry>(
  collection: 'history' | 'photos',
  params: URLSearchParams,
  map: (doc: FirebaseFirestore.QueryDocumentSnapshot) => T,
): Promise<Page<T>> {
  const filter = params.get('tipo');
  if (filter && !/^[a-z_]{1,32}$/.test(filter)) throw new HttpError(400, 'El filtro es inválido.');
  const rawLimit = params.get('limit');
  const limit = rawLimit === null ? 30 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'El límite debe estar entre 1 y 100.');
  const rawCursor = params.get('cursor');
  let query: Query = db().collection(collection);
  if (filter && collection === 'history') query = query.where('tipo', '==', filter);
  query = query.orderBy('recordedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (rawCursor !== null) {
    try {
      if (rawCursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new Error();
      const [at, id] = cursorSchema.parse(JSON.parse(Buffer.from(rawCursor, 'base64url').toString()));
      query = query.startAfter(Timestamp.fromMillis(at), id);
    } catch {
      throw new HttpError(400, 'El cursor es inválido.');
    }
  }
  const result = await query.limit(limit + 1).get();
  const items = result.docs.slice(0, limit);
  const last = items.at(-1);
  const next = last && result.size > limit
    ? Buffer.from(JSON.stringify([(last.get('recordedAt') as Timestamp).toMillis(), last.id])).toString('base64url')
    : null;
  return { items: items.map(map), next };
}
