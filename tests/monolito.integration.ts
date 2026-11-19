import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:tls';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Aedes } from 'aedes';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { connectAsync } from 'mqtt';
import { topics, type CommandResult, type Dashboard, type HistoryEntry, type Page, type Photo } from '../src/lib/contracts';

async function eventually<T>(run: () => Promise<T>, condition: (result: T) => boolean, label: string, attempts = 60) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await run();
      if (condition(result)) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error('Agotó la espera de ' + label, { cause: lastError });
}

test('login y permisos, telemetría por MQTT TLS, dispensación idempotente y galería', { timeout: 90_000 }, async (t) => {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
  const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  assert.ok(authHost && firestoreHost && storageHost, 'Ejecuta los emuladores de Auth, Firestore y Storage.');
  const projectId = 'demo-dispensador';
  const bucket = projectId + '.appspot.com';
  const dir = mkdtempSync(join(tmpdir(), 'dispensador-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, 'tls.key');
  const certFile = join(dir, 'tls.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-keyout', keyFile, '-out', certFile, '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'],
    { stdio: 'ignore' });
  const ca = readFileSync(certFile);
  const aedes = await Aedes.createBroker({
    authenticate: (_client, username, password, done) => done(null, Boolean(username && password?.toString() === 'test-mqtt')),
  });
  const mqttServer = createServer({ key: readFileSync(keyFile), cert: ca }, (socket) => { aedes.handle(socket); });
  mqttServer.listen(0, '127.0.0.1');
  await once(mqttServer, 'listening');
  const bound = mqttServer.address();
  assert.ok(bound && typeof bound !== 'string');
  const url = 'mqtts://127.0.0.1:' + bound.port;
  const mqtt = await connectAsync(url, { ca, username: 'placas', password: 'test-mqtt', reconnectPeriod: 0 });
  t.after(async () => {
    await mqtt.endAsync(true);
    await new Promise<void>((resolve) => aedes.close(resolve));
    await new Promise<void>((resolve, reject) => mqttServer.close((error) => error ? reject(error) : resolve()));
  });

  const app = initializeApp({ projectId });
  t.after(() => deleteApp(app));
  const database = getFirestore(app);
  const auth = getAuth(app);
  const suffix = randomUUID();
  async function newUser(name: string) {
    const email = name + '-' + suffix + '@example.test';
    const password = 'local-test-password-2026';
    const user = await auth.createUser({ email, password });
    const result = await fetch('http://' + authHost + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    assert.equal(result.status, 200, await result.clone().text());
    const { idToken } = await result.json();
    return { user, token: idToken as string };
  }
  const [allowed, denied] = await Promise.all([newUser('operador'), newUser('sin-permiso')]);
  await database.collection('operators').doc(allowed.user.uid).set({ active: true });

  const temporary = netServer().listen(0, '127.0.0.1');
  await once(temporary, 'listening');
  const addr = temporary.address();
  assert.ok(addr && typeof addr !== 'string');
  const { port } = addr;
  await new Promise<void>((resolve) => temporary.close(() => resolve()));
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, FIREBASE_PROJECT_ID: projectId, FIREBASE_STORAGE_BUCKET: bucket,
      GOOGLE_APPLICATION_CREDENTIALS: '', MQTT_URL: url, MQTT_SITE_ID: 'prueba', MQTT_USERNAME: 'monolito',
      MQTT_PASSWORD: 'test-mqtt', MQTT_CA_FILE: certFile, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (chunk) => { log += chunk; });
  server.stderr.on('data', (chunk) => { log += chunk; });
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill();
      await once(server, 'exit');
    }
    if (!/Ready/.test(log) || /error/i.test(log)) t.diagnostic(log.trim());
  });
  const base = 'http://127.0.0.1:' + port;
  const get = (path: string, token?: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (options?.body) headers.set('Content-Type', 'application/json');
    return fetch(base + '/api/' + path, { ...options, headers });
  };
  await eventually(() => get('health'), (r) => r.ok, 'Next.js');

  assert.equal((await get('dashboard')).status, 401);
  assert.equal((await get('dashboard', 'invalido')).status, 401);
  assert.equal((await get('dashboard', denied.token)).status, 403);
  assert.equal((await get('session', allowed.token)).status, 200);
  const direct = await fetch('http://' + firestoreHost + '/v1/projects/' + projectId +
    '/databases/(default)/documents/operators/' + allowed.user.uid, { headers: { Authorization: 'Bearer ' + allowed.token } });
  assert.equal(direct.status, 403, 'Firestore bloquea el acceso directo del cliente');

  const dashboard = async () => {
    const response = await get('dashboard', allowed.token);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as Dashboard;
  };
  await eventually(dashboard, (d) => d.mqtt, 'suscripciones MQTT');
  assert.equal((await dashboard()).esp32.online, false);

  const names = topics('prueba');
  const sentAt = Math.floor(Date.now() / 1000);
  const telemetry = { dispositivo: 'ESP32', estado: 'ESPERANDO', nivel_tolva: 69, sensor_nivel_ok: true, max_porciones: 3, dispensaciones_total: 0 };
  await mqtt.publishAsync(names.telemetry, JSON.stringify({ sentAt: sentAt - 90, data: telemetry }));
  await mqtt.publishAsync(names.telemetry, JSON.stringify({ sentAt, data: telemetry }));
  await mqtt.publishAsync(names.cameraStatus, JSON.stringify({ sentAt, data: { camara: true, resolucion: 'VGA' } }));
  await mqtt.publishAsync(names.alert, JSON.stringify({ sentAt, data: { tipo: 'COMIDA_BAJA', nivel: 12 } }));
  const connected = await eventually(dashboard, (d) => d.esp32.online && d.camera.online, 'telemetría en Firestore');
  assert.equal(connected.esp32.data?.nivel_tolva, 69);
  assert.equal((await database.collection('telemetry').get()).size, 1);

  const jpeg = Buffer.from([0xff, 0xd8, 0x41, 0x42, 0xff, 0xd9]);
  let commandCount = 0;
  let answerCommands = true;
  await mqtt.subscribeAsync([names.command, names.cameraRequest]);
  mqtt.on('message', (topic, payload, packet) => {
    const message = JSON.parse(payload.toString());
    assert.equal(packet.retain, false);
    assert.ok(message.expiresAt * 1000 > Date.now());
    if (topic === names.command) {
      commandCount++;
      if (answerCommands) void mqtt.publishAsync(names.ack, JSON.stringify({ id: message.id, ok: true, resultado: 'ACEPTADA' }));
    }
    if (topic === names.cameraRequest) void mqtt.publishAsync(names.cameraFrame + message.id, jpeg);
  });

  const command = { id: randomUUID(), operation: 'dispense', portions: 2, confirm: true };
  const send = (input: object) => get('commands', allowed.token, { method: 'POST', body: JSON.stringify(input) });
  assert.equal((await send({ ...command, confirm: false })).status, 400);
  assert.equal((await send({ ...command, portions: 4 })).status, 400);
  const result = await send(command);
  assert.equal(result.status, 200, await result.clone().text());
  assert.deepEqual(await result.json(), { id: command.id, state: 'accepted', result: 'ACEPTADA' });
  assert.equal((await (await send(command)).json() as CommandResult).state, 'accepted');
  assert.equal(commandCount, 1);
  assert.equal((await send({ ...command, portions: 1 })).status, 409);
  assert.equal((await send({ ...command, id: randomUUID() })).status, 429);

  answerCommands = false;
  const unanswered = { id: randomUUID(), operation: 'reset-errors' };
  assert.equal((await (await send(unanswered)).json() as CommandResult).state, 'outcome_unknown');
  assert.equal((await (await send(unanswered)).json() as CommandResult).state, 'outcome_unknown');
  assert.equal(commandCount, 2);

  const history = await (await get('history?tipo=alerta', allowed.token)).json() as Page<HistoryEntry>;
  assert.equal(history.items[0]?.tipo, 'alerta');
  const one = await (await get('history?limit=1', allowed.token)).json() as Page<HistoryEntry>;
  assert.ok(one.next);
  const older = await (await get('history?limit=1&cursor=' + one.next, allowed.token)).json() as Page<HistoryEntry>;
  assert.notEqual(older.items[0]?.id, one.items[0]?.id);
  const frame = await get('camera/frame', allowed.token);
  assert.equal(frame.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await frame.arrayBuffer()), jpeg);

  const saved = await get('camera/capture', allowed.token, { method: 'POST' });
  assert.equal(saved.status, 201, await saved.clone().text());
  const photo = await saved.json() as Photo;
  const gallery = await (await get('gallery', allowed.token)).json() as Page<Photo>;
  assert.ok(gallery.items.some((item) => item.name === photo.name));
  assert.equal((await get('gallery/' + photo.name, denied.token)).status, 403);
  const downloaded = await get('gallery/' + photo.name + '?download=1', allowed.token);
  assert.match(downloaded.headers.get('content-disposition') ?? '', /^attachment/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), jpeg);
  assert.equal((await get('gallery/' + photo.name, allowed.token, { method: 'DELETE' })).status, 400);
  assert.equal((await get('gallery/' + photo.name, allowed.token, { method: 'DELETE', headers: { 'X-Confirm': 'delete' } })).status, 200);
  assert.equal((await get('gallery/' + photo.name, allowed.token)).status, 404);

  const setting = (interval_s: number) => get('camera/settings', allowed.token, { method: 'PUT', body: JSON.stringify({ interval_s }) });
  assert.equal((await setting(5)).status, 400);
  assert.equal((await setting(10)).status, 200);
  await eventually(() => database.collection('photos').where('source', '==', 'auto').get(), (snapshot) => !snapshot.empty, 'captura automática');
  assert.equal((await setting(0)).status, 200);

  await database.collection('operators').doc(allowed.user.uid).update({ active: false });
  assert.equal((await get('dashboard', allowed.token)).status, 403);
});
