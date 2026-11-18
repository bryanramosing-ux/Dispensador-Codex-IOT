import { consume, deviceToken, jpeg, mockDevice, nest, python, remove, scratch, telemetry } from './support';

const token = { 'X-Device-Token': deviceToken };
const stable = <T>(value: T) =>
  JSON.parse(
    JSON.stringify(value, (key, item) =>
      ['age_s', 'ts', 'uptime_s', 'backend_uptime_s'].includes(key) ? undefined : item,
    ),
  ) as T;

describe('contrato diferencial Python ↔ NestJS', () => {
  const dir = scratch(),
    legacy = scratch();
  let device: Awaited<ReturnType<typeof mockDevice>>;
  let newer: Awaited<ReturnType<typeof nest>>;
  let older: Awaited<ReturnType<typeof python>>;

  beforeAll(async () => {
    device = await mockDevice();
    older = await python(legacy, device.base);
    newer = await nest(dir, { ESP32_URL: device.base, ESP32_CAM_URL: device.base });
  });
  afterAll(async () => {
    await newer?.close();
    await older?.close();
    await device?.close();
    remove(dir);
    remove(legacy);
  });

  async function compare(
    path: string,
    method: string,
    expected: number,
    body?: unknown,
    headers?: Record<string, string>,
  ) {
    const source = await older.call(path, method, body, headers);
    const target = await newer.call(path, method, body, headers);
    expect([source.status, target.status]).toEqual([expected, expected]);
    return [source, target] as const;
  }

  it('valida autenticación, bytes, JSON y esquema de telemetría y conserva campos y unidades', async () => {
    const path = '/api/device/telemetry';
    for (const [body, headers, expected] of [
      [telemetry, {}, 401],
      [{ dispositivo: 'otro' }, token, 400],
      ['{no JSON', token, 400],
      [[1, 2], token, 400],
      [{ ...telemetry, extra: 'x'.repeat(9000) }, token, 413],
      [telemetry, token, 200],
    ] as const) {
      const [source, target] = await compare(path, 'POST', expected, body, headers);
      expect(await target.json()).toEqual(await source.json());
    }
    const [source, target] = await compare('/api/status', 'GET', 200);
    expect(stable(await target.json())).toEqual(stable(await source.json()));
    for (const input of [{ dispositivo: 'ESP32', tipo: 'COMIDA_BAJA', nivel: 18 }, { tipo: 'mal' }]) {
      const [a, b] = await compare(
        '/api/device/alert',
        'POST',
        input.tipo === 'mal' ? 400 : 200,
        input,
        token,
      );
      expect(await b.json()).toEqual(await a.json());
    }
    const [oldHistory, newHistory] = await compare('/api/history?limit=1&tipo=alerta', 'GET', 200);
    expect(stable(await newHistory.json())).toEqual(stable(await oldHistory.json()));
  });

  it('preserva la semántica HTTP de confirmación, porciones, reset y rechazo de firmware', async () => {
    await compare('/api/device/telemetry', 'POST', 200, telemetry, token);
    await compare('/api/dispense', 'GET', 404);
    await compare('/api/dispense', 'POST', 400, { porciones: 1, confirm: 'true' });
    await compare('/api/dispense', 'POST', 400, { porciones: true, confirm: true });
    await compare('/api/dispense', 'POST', 400, '{"porciones":1.0,"confirm":true}');
    await compare('/api/dispense', 'POST', 400, { porciones: 4, confirm: true });
    for (const code of [202, 409, 401, 429]) {
      device.state.code = code;
      const [a, b] = await compare('/api/dispense', 'POST', code, { porciones: 2, confirm: true });
      expect(await b.json()).toEqual(await a.json());
      expect(
        device.calls.slice(-2).map((call) => [call.path, call.body.get('token'), call.body.get('porciones')]),
      ).toEqual(Array.from({ length: 2 }, () => ['/dispensar', deviceToken, '2']));
    }
    device.state.code = 202;
    const [a, b] = await compare('/api/reset-errors', 'POST', 200);
    expect(await b.json()).toEqual(await a.json());
  });

  it('preserva refresh, fotograma, captura, galería, foto, borrado y ajuste automático', async () => {
    const [refreshA, refreshB] = await compare('/api/camera/refresh', 'POST', 200);
    expect(await refreshB.json()).toEqual(await refreshA.json());
    const frames = await compare('/api/camera/frame', 'GET', 200);
    for (const item of frames) expect(Buffer.from(await item.arrayBuffer())).toEqual(jpeg);
    const [a, b] = await compare('/api/capture', 'POST', 200);
    const names = await Promise.all([a.json(), b.json()]);
    for (const [index, service] of [older, newer].entries()) {
      expect(names[index]).toEqual({
        ok: true,
        name: expect.stringMatching(/^foto_\d{8}_\d{6}_[0-9a-f]{6}\.jpg$/),
        size: jpeg.length,
      });
      const name = names[index].name;
      const photo = '/api/gallery/' + name;
      const list = await service.call('/api/gallery');
      expect(await list.json()).toEqual({ items: [{ name, size: jpeg.length, ts: expect.any(String) }] });
      const download = await service.call(photo + '?download=1');
      expect(download.headers.get('content-disposition')).toBe('attachment; filename="' + name + '"');
      expect(Buffer.from(await download.arrayBuffer())).toEqual(jpeg);
      expect((await service.call(photo, 'DELETE')).status).toBe(400);
      expect(
        await (await service.call(photo, 'DELETE', undefined, { 'X-Confirm': 'delete' })).json(),
      ).toEqual({ ok: true, deleted: name });
      expect((await service.call(photo)).status).toBe(404);
    }
    await compare('/api/auto-capture', 'POST', 400, { interval_s: 6 });
    await compare('/api/auto-capture', 'POST', 400, '{"interval_s":30.0}');
    const [s, t] = await compare('/api/auto-capture', 'POST', 200, { interval_s: 30 });
    expect(await t.json()).toEqual(await s.json());
    device.state.cameraCode = 409;
    await compare('/api/camera/frame', 'GET', 409);
    await compare('/api/capture', 'POST', 503);
    device.state.cameraCode = 503;
    await compare('/api/camera/refresh', 'POST', 200);
    await compare('/api/camera/stream', 'GET', 503);
    device.state.cameraCode = 200;
  });

  it('entrega status como primer evento SSE e historial como objetos con id, ts, tipo y mensaje', async () => {
    await compare('/api/device/telemetry', 'POST', 200, telemetry, token);
    const sse = await compare('/api/events', 'GET', 200);
    const first = await Promise.all(
      sse.map(async (response) => {
        expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
        const raw = await consume(response, (data) => data.includes('\n\n'));
        const [, body] = /^event: status\ndata: (.*)\n/m.exec(raw.toString()) ?? [];
        return stable(JSON.parse(body));
      }),
    );
    expect(first[0]).toEqual(first[1]);
    const [source, target] = await compare('/api/health', 'GET', 200);
    expect(stable(await target.json())).toEqual(stable(await source.json()));
  });
});
