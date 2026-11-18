import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type ServerHttp2Session } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { FirestoreService } from '../src/persistence/firestore.service';
import { LocalStore, type PendingWrite } from '../src/persistence/local-store';
import { deviceToken, jpeg, mockDevice, nest, remove, scratch, telemetry } from './support';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error('Configure FIRESTORE_EMULATOR_HOST antes de ejecutar la prueba');
});

it('reproduce en Firestore emulado una cola pendiente tras reinicio sin duplicar muestras, eventos, comandos ni fotos', async () => {
  const dir = scratch();
  const device = await mockDevice();
  const project = 'demo-iot-' + randomBytes(4).toString('hex');
  const env = { FIREBASE_PROJECT_ID: project, ESP32_URL: device.base, ESP32_CAM_URL: device.base };
  let service = await nest(dir, env);
  try {
    const token = { 'X-Device-Token': deviceToken };
    await service.call('/api/device/telemetry', 'POST', telemetry, token);
    await service.call('/api/device/telemetry', 'POST', telemetry, token);
    const alert = { dispositivo: 'ESP32', tipo: 'COMIDA_BAJA', nivel: 18 };
    await service.call('/api/device/alert', 'POST', alert, token);
    await service.call('/api/device/alert', 'POST', alert, token);
    await service.call(
      '/api/dispense',
      'POST',
      { porciones: 2, confirm: true },
      { 'Idempotency-Key': 'op-emulator' },
    );
    const { name } = await (await service.call('/api/capture', 'POST')).json();
    await service.call('/api/auto-capture', 'POST', { interval_s: 30 });
    const original = service.app.get(LocalStore).pendingCount();
    expect(original).toBeGreaterThan(0);

    const cloud = service.app.get(FirestoreService);
    const local = service.app.get(LocalStore);
    const initial = local.pending() as PendingWrite;
    // Emulate an ACK lost after a real Firestore commit. The SQLite item is kept.
    const actual = cloud.commit.bind(cloud);
    const injected = jest.spyOn(cloud, 'commit').mockImplementationOnce(async (entry) => {
      await actual(entry);
      throw new Error('ACK perdido');
    });
    await cloud.drain();
    await cloud.drain();
    expect(injected).toHaveBeenCalledTimes(1);
    expect(local.pendingCount()).toBe(original);
    expect((await cloud.db.collection('telemetry').get()).size).toBe(1);

    await service.close();
    service = await nest(dir, env);
    const resumed = service.app.get(FirestoreService);
    const localAfter = service.app.get(LocalStore);
    expect(localAfter.pending()).toEqual(initial);
    await resumed.drain();
    expect(localAfter.pendingCount()).toBe(0);
    expect((await resumed.db.collection('telemetry').get()).size).toBe(1);
    expect((await resumed.db.collection('device_status').doc('esp32').get()).data()).toMatchObject({
      data: telemetry,
    });
    expect((await resumed.db.collection('events').where('tipo', '==', 'alerta').get()).size).toBe(1);
    expect((await resumed.db.collection('history').get()).size).toBe(
      localAfter.page('history', 100).items.length,
    );
    const command = (await resumed.db.collection('commands').doc('request-op-emulator').get()).data();
    expect(command).toMatchObject({ state: 'accepted', confirmed: true, status: 202 });
    expect((await resumed.db.collection('photos').doc(name).get()).data()).toMatchObject({
      name,
      size: jpeg.length,
    });
    expect((await resumed.db.collection('settings').doc('dashboard').get()).data()).toMatchObject({
      auto_capture_s: 30,
    });
    const page = await resumed.page('history', 1);
    const next = await resumed.page('history', 1, { at: page[0].data.recordedAt.toMillis(), id: page[0].id });
    expect(next[0].id).not.toBe(page[0].id);
    expect(await resumed.page('history', 10, undefined, 'alerta')).toHaveLength(1);

    await service.call('/api/gallery/' + name, 'DELETE', undefined, { 'X-Confirm': 'delete' });
    expect(await (await service.call('/api/gallery/' + name)).status).toBe(404);
    await resumed.drain();
    expect((await resumed.db.collection('photos').doc(name).get()).exists).toBe(false);
    expect(localAfter.jpeg(name)).toBeUndefined();
    expect(device.calls).toHaveLength(1);
  } finally {
    await service.close();
    await device.close();
    remove(dir);
  }
});

it('persiste y sirve datos cuando el transporte Firestore falla y los replica al recuperar conexión', async () => {
  const failing = createServer();
  const sessions = new Set<ServerHttp2Session>();
  let rejected = 0;
  failing.on('session', (session) => {
    sessions.add(session);
    session.once('close', () => sessions.delete(session));
  });
  failing.on('stream', (stream) => {
    ++rejected;
    stream.respond(
      { ':status': 200, 'content-type': 'application/grpc', 'grpc-status': '7' },
      { endStream: true },
    );
  });
  failing.listen(0, '127.0.0.1');
  await once(failing, 'listening');
  const dir = scratch();
  const project = 'demo-iot-' + randomBytes(4).toString('hex');
  let service = await nest(dir, {
    FIREBASE_PROJECT_ID: project,
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:' + (failing.address() as AddressInfo).port,
  });
  try {
    const post = await service.call('/api/device/telemetry', 'POST', telemetry, {
      'X-Device-Token': deviceToken,
    });
    expect(post.status).toBe(200);
    await service.app.get(FirestoreService).drain();
    expect(rejected).toBeGreaterThan(0);
    expect(service.app.get(LocalStore).pendingCount()).toBe(1);
    const snapshot = await (await service.call('/api/status')).json();
    expect(snapshot.esp32.data).toEqual(telemetry);
    for (const session of sessions) session.destroy();
    await service.close();
    service = await nest(dir, { FIREBASE_PROJECT_ID: project });
    const cloud = service.app.get(FirestoreService);
    await cloud.drain();
    expect((await cloud.db.collection('telemetry').get()).size).toBe(1);
    expect(service.app.get(LocalStore).pendingCount()).toBe(0);
  } finally {
    await service.close();
    for (const session of sessions) session.destroy();
    await new Promise<void>((resolve) => failing.close(() => resolve()));
    remove(dir);
  }
});

const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
(storageHost ? it : it.skip)(
  'sube JPEG privados a Cloud Storage y borra el objeto y su metadato',
  async () => {
    const dir = scratch();
    const device = await mockDevice();
    const bucket = 'demo-dispensador.appspot.com';
    const service = await nest(dir, { ESP32_CAM_URL: device.base, FIREBASE_STORAGE_BUCKET: bucket });
    try {
      const cloud = service.app.get(FirestoreService);
      const store = service.app.get(LocalStore);
      const capture = await service.call('/api/capture', 'POST');
      expect(capture.status).toBe(200);
      const { name } = await capture.json();
      await cloud.commit(store.pending() as PendingWrite);
      await cloud.drain();
      expect(store.pendingCount()).toBe(0);
      const objectPath = 'gallery/' + name;
      expect((await cloud.db.collection('photos').doc(name).get()).data()).toMatchObject({
        name,
        objectPath,
      });
      const url =
        'http://' + storageHost + '/v0/b/' + bucket + '/o/' + encodeURIComponent(objectPath) + '?alt=media';
      const header = { headers: { Authorization: 'Bearer owner' } };
      expect((await fetch(url)).status).toBe(403);
      expect(Buffer.from(await (await fetch(url, header)).arrayBuffer())).toEqual(jpeg);
      await service.call('/api/gallery/' + name, 'DELETE', undefined, { 'X-Confirm': 'delete' });
      await cloud.drain();
      expect((await fetch(url, header)).status).toBe(404);
      expect((await cloud.db.collection('photos').doc(name).get()).exists).toBe(false);
      expect(store.pendingCount()).toBe(0);
    } finally {
      await service.close();
      await device.close();
      remove(dir);
    }
  },
);
