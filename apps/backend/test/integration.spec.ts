import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { DevicesService } from '../src/devices/devices.service';
import { LocalStore } from '../src/persistence/local-store';
import { consume, deviceToken, jpeg, mockDevice, nest, remove, request, scratch, telemetry } from './support';

const token = { 'X-Device-Token': deviceToken };
const key = (name: string) => ({ 'Idempotency-Key': name });
const valid = { porciones: 1, confirm: true };

describe('HTTP y persistencia local con dispositivos simulados', () => {
  let dir: string;
  let device: Awaited<ReturnType<typeof mockDevice>>;
  let service: Awaited<ReturnType<typeof nest>>;
  beforeEach(async () => {
    dir = scratch();
    device = await mockDevice();
    service = await nest(dir, {
      ESP32_URL: device.base,
      ESP32_CAM_URL: device.base,
      DASHBOARD_ORIGINS: 'http://localhost:5173',
    });
  });
  afterEach(async () => {
    await service?.close();
    await device?.close();
    remove(dir);
  });

  it('protege lecturas sensibles, acciones, CSRF, CORS y acceso directo de dispositivos', async () => {
    const unauth = request(service.base);
    for (const path of ['/api/status', '/api/events', '/api/history', '/api/gallery', '/api/camera/frame']) {
      expect((await unauth(path)).status).toBe(401);
    }
    expect((await unauth('/api/dispense', 'POST', valid)).status).toBe(401);
    expect((await service.call('/api/dispense', 'POST', valid, { 'X-Requested-With': '' })).status).toBe(403);
    const rejected = await service.call('/api/dispense', 'POST', valid, {
      Origin: 'https://ejemplo.invalid',
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.has('access-control-allow-origin')).toBe(false);
    const allowed = await service.call('/api/dispense', 'OPTIONS', undefined, {
      Origin: 'http://localhost:5173',
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect((await unauth('/api/device/telemetry', 'POST', telemetry)).status).toBe(401);
    expect((await unauth('/api/device/telemetry', 'POST', telemetry, token)).status).toBe(200);
    expect(device.calls).toHaveLength(0);
    const badCookie = request(service.base, service.cookie + 'x');
    expect((await badCookie('/api/status')).status).toBe(401);
    for (let index = 0; index < 5; index++) {
      expect((await unauth('/api/session', 'POST', { password: 'incorrecta' })).status).toBe(401);
    }
    expect((await unauth('/api/session', 'POST', { password: 'incorrecta' })).status).toBe(429);
  });

  it('impide reenviar comandos, conserva confirmaciones y trata pérdida de respuesta como resultado desconocido', async () => {
    await service.call('/api/device/telemetry', 'POST', { ...telemetry, ip: '169.254.169.254' }, token);
    const status = await (await service.call('/api/status')).json();
    expect(status.esp32.ip).toBe('127.0.0.1');
    const first = await service.call('/api/dispense', 'POST', valid, key('accion-estable'));
    expect(first.status).toBe(202);
    expect((await service.call('/api/dispense', 'POST', valid, key('accion-estable'))).status).toBe(202);
    expect(
      (await service.call('/api/dispense', 'POST', { ...valid, porciones: 2 }, key('accion-estable'))).status,
    ).toBe(409);
    expect(device.calls).toHaveLength(1);
    device.state.dropped = true;
    expect((await service.call('/api/dispense', 'POST', valid, key('accion-sin-respuesta'))).status).toBe(
      503,
    );
    expect((await service.call('/api/dispense', 'POST', valid, key('accion-sin-respuesta'))).status).toBe(
      503,
    );
    expect(device.calls).toHaveLength(2);
    const local = service.app.get(LocalStore);
    expect(local.get('commands', 'request-accion-estable')).toMatchObject({
      confirmed: true,
      state: 'accepted',
      status: 202,
    });
    expect(local.get('commands', 'request-accion-sin-respuesta')).toMatchObject({
      state: 'outcome_unknown',
      status: 503,
    });
  });

  it('rechaza redirecciones, aun cuando el destino sea otro host configurado para pruebas', async () => {
    const other = await mockDevice();
    try {
      await service.call('/api/device/telemetry', 'POST', telemetry, token);
      device.state.redirect = other.base + '/dispensar';
      expect((await service.call('/api/dispense', 'POST', valid)).status).toBe(503);
      expect(other.calls).toHaveLength(0);
    } finally {
      await other.close();
    }
  });

  it('mantiene la galería, ajustes y paginación al reiniciar, y distingue datos anteriores', async () => {
    await service.call('/api/device/telemetry', 'POST', telemetry, token);
    const live = service.app.get(DevicesService);
    live.watchdog(Date.now() + 20000);
    expect((await (await service.call('/api/status')).json()).esp32).toMatchObject({
      data: null,
      last_data: telemetry,
      online: false,
    });
    const capture = await (await service.call('/api/capture', 'POST')).json();
    await service.call('/api/auto-capture', 'POST', { interval_s: 30 });
    const old = service.app.get(LocalStore).pendingCount();
    await service.close();
    service = await nest(dir, { ESP32_URL: device.base, ESP32_CAM_URL: device.base });
    const status = await (await service.call('/api/status')).json();
    expect(status.auto_capture_s).toBe(30);
    expect(status.last_photo.name).toBe(capture.name);
    expect(status.esp32.online).toBe(false);
    const photo = await service.call('/api/gallery/' + capture.name);
    expect(Buffer.from(await photo.arrayBuffer())).toEqual(jpeg);
    expect(service.app.get(LocalStore).pendingCount()).toBe(old);
    const first = await service.call('/api/history?limit=1');
    const second = await service.call('/api/history?limit=1&cursor=' + first.headers.get('x-next-cursor'));
    const a = (await first.json()).items[0],
      b = (await second.json()).items[0];
    expect(a.id).not.toBe(b.id);
    expect(Date.parse(a.ts)).toBeGreaterThanOrEqual(Date.parse(b.ts));
    expect((await service.call('/api/history?cursor=inválido')).status).toBe(400);
    expect((await service.call('/api/gallery/foto_%2Fpasswd.jpg')).status).toBe(404);
  });

  it('emite evento SSE de alerta, recupera estado al reconectar y retransmite dos conexiones MJPEG del firmware', async () => {
    const response = await service.call('/api/events');
    const receiving = consume(response, (buffer) => buffer.includes('event: evento'));
    await service.call(
      '/api/device/alert',
      'POST',
      { dispositivo: 'ESP32', tipo: 'COMIDA_BAJA', nivel: 20 },
      token,
    );
    expect((await receiving).toString()).toMatch(/event: evento\ndata: .*"tipo":"alerta"/);
    const reopened = await service.call('/api/events');
    expect((await consume(reopened, (buffer) => buffer.includes('event: status'))).toString()).toContain(
      'event: status',
    );
    expect((await service.call('/api/camera/refresh', 'POST')).status).toBe(200);
    const video = await service.call('/api/camera/stream');
    expect(video.headers.get('content-type')).toBe('multipart/x-mixed-replace; boundary=esp32cam');
    const parts = await consume(video, (buffer) => buffer.indexOf(jpeg) !== buffer.lastIndexOf(jpeg));
    expect(parts.toString('latin1').match(/--esp32cam/g)).toHaveLength(2);
    expect(device.streams()).toBeGreaterThanOrEqual(2);
    expect((await service.call('/api/capture', 'POST')).status).toBe(200);
  });
});

it('responde al descubrimiento UDP con la firma del firmware', async () => {
  const dir = scratch();
  const client = createSocket('udp4');
  const locator = createSocket('udp4');
  locator.bind(0, '127.0.0.1');
  await once(locator, 'listening');
  const { port } = locator.address();
  await new Promise<void>((resolve) => locator.close(resolve));
  const service = await nest(dir, { PUERTO_DESCUBRIMIENTO: String(port), PORT: '8123' });
  try {
    client.send('DISPENSADOR?', port, '127.0.0.1');
    const [message] = await once(client, 'message', { signal: AbortSignal.timeout(3000) });
    expect(message.toString()).toBe('DISPENSADOR!8123');
  } finally {
    client.close();
    await service.close();
    remove(dir);
  }
});

it('aplica el intervalo incluso tras reiniciar y nunca reenvía un despacho interrumpido', async () => {
  const dir = scratch();
  const device = await mockDevice();
  const env = { ESP32_URL: device.base, MIN_DISPENSE_GAP_S: '30' };
  let service = await nest(dir, env);
  try {
    await service.call('/api/device/telemetry', 'POST', { ...telemetry, dispensando: true }, token);
    expect((await service.call('/api/dispense', 'POST', valid)).status).toBe(409);
    await service.call('/api/device/telemetry', 'POST', telemetry, token);
    expect((await service.call('/api/dispense', 'POST', valid)).status).toBe(202);
    expect((await service.call('/api/dispense', 'POST', valid)).status).toBe(429);
    service.app.get(LocalStore).atomic((tx) => {
      tx.set('commands', 'request-interrumpido', Date.now(), {
        state: 'dispatching',
        operation: 'dispense',
        portions: 1,
        confirmed: true,
        requestedAt: new Date().toISOString(),
      });
    });
    await service.close();
    service = await nest(dir, env);
    expect((await service.call('/api/dispense', 'POST', valid, key('interrumpido'))).status).toBe(503);
    await service.call('/api/device/telemetry', 'POST', telemetry, token);
    expect((await service.call('/api/dispense', 'POST', valid)).status).toBe(429);
    expect(device.calls).toHaveLength(1);
  } finally {
    await service.close();
    await device.close();
    remove(dir);
  }
});

it('mantiene deshabilitado el control y falla cerrado para dispositivos sin token configurado', async () => {
  const dir = scratch();
  const service = await nest(dir, { TOKEN_DISPOSITIVO: '' });
  try {
    expect((await service.call('/api/device/telemetry', 'POST', telemetry)).status).toBe(401);
    expect((await service.call('/api/dispense', 'POST', valid)).status).toBe(403);
    expect((await service.call('/api/reset-errors', 'POST')).status).toBe(403);
  } finally {
    await service.close();
    remove(dir);
  }
});
