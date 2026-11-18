import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createApp } from '../src/main';

export const deviceToken = 'token-para-pruebas-locales';
const password = 'una-clave-desechable-larga';
export const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
export const telemetry = {
  dispositivo: 'ESP32',
  fw: '2.0.0',
  modo: 'MANUAL',
  estado: 'ESPERANDO',
  error: '',
  wifi_conectado: true,
  ip: '127.0.0.1',
  rssi: -50,
  backend: true,
  sensor_nivel_ok: true,
  distancia_nivel_cm: 9.5,
  nivel_tolva: 65,
  alerta_tolva: 'NINGUNA',
  alerta_pendiente: false,
  servo: 'REPOSO',
  dispensando: false,
  pulso_servo_us: 1500,
  dispensaciones_total: 0,
  dispensaciones_24h: 0,
  ultima_dispensacion_hace_s: -1,
  ultimo_origen: 'NINGUNO',
  ultimas_porciones: 0,
  ultimo_resultado: '',
  cooldown_s: 0,
  max_porciones: 3,
  distancia_cm: -1.0,
  ultima_clase: 0,
  ultima_confianza: 0,
  ultimo_motivo: '',
  raciones_perro: 0,
  raciones_gato: 0,
  raciones_manual: 0,
  v_servo: -1.0,
  v_bateria: -1.0,
  uptime_s: 91,
  heap: 91000,
};
export const scratch = () => mkdtempSync(resolve(tmpdir(), 'dispensador-test-'));
export const remove = (dir: string) => rmSync(dir, { force: true, recursive: true });

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
}

export async function mockDevice() {
  const calls: Array<{ path: string; body: URLSearchParams }> = [];
  const state = { redirect: '', code: 202, cameraCode: 200, cameraStream: true, dropped: false };
  const handle: RequestListener = async (req, res) => {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      calls.push({ path: req.url ?? '', body: new URLSearchParams(Buffer.concat(chunks).toString()) });
      if (state.dropped) {
        res.destroy();
        return;
      }
      if (state.redirect) {
        res.writeHead(302, { location: state.redirect }).end();
        return;
      }
      if (req.url === '/reset-errores') {
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ ok: true, resultado: 'ERRORES_BORRADOS' }));
        return;
      }
      res.writeHead(state.code, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          ok: state.code === 202,
          resultado: state.code === 202 ? 'ACEPTADA' : 'COOLDOWN',
          cooldown_s: 3,
        }),
      );
    } else if (req.url === '/status') {
      res.writeHead(state.cameraCode, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          camara: state.cameraCode === 200,
          psram: true,
          fotos_ok: 1,
          fotos_fallidas: 0,
          uptime_s: 5,
          stream: state.cameraStream,
          resolucion: 'VGA 640x480',
        }),
      );
    } else if (req.url === '/capture') {
      res
        .writeHead(state.cameraCode, { 'Content-Type': 'image/jpeg' })
        .end(state.cameraCode === 200 ? jpeg : '');
    } else res.writeHead(404).end();
  };
  const server = createServer(handle);
  let streams = 0;
  server.prependListener('request', (req, res) => {
    if (req.url !== '/stream') return;
    const socket = res.socket;
    if (!socket) return;
    res.detachSocket(socket);
    req.url = '/finished';
    ++streams;
    // Arduino writes a raw multipart body despite reporting Content-Length: 0.
    socket.end(
      Buffer.concat([
        Buffer.from(
          'HTTP/1.0 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=esp32cam\r\nContent-Length: 0\r\nConnection: close\r\n\r\n' +
            '--esp32cam\r\nContent-Type: image/jpeg\r\nContent-Length: ' +
            jpeg.length +
            '\r\n\r\n',
        ),
        jpeg,
        Buffer.from('\r\n'),
      ]),
    );
  });
  const base = await listen(server);
  return { base, calls, state, streams: () => streams, close: () => closeServer(server) };
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
    server.closeAllConnections();
  });
}

export function request(base: string, cookie?: string) {
  return (path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) =>
    fetch(base + path, {
      method,
      headers: {
        'X-Requested-With': 'dashboard',
        Connection: 'close',
        ...(cookie && { Cookie: cookie }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
}

export async function nest(dir: string, config: Record<string, string> = {}) {
  const old = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    STORAGE_DIR: dir,
    ADMIN_PASSWORD: password,
    SESSION_SECRET: 'ejemplo-de-pruebas-desechable-sesion',
    FIREBASE_PROJECT_ID: 'demo-dispensador',
    FIREBASE_STORAGE_BUCKET: '',
    ESP32_CAM_URL: '',
    ESP32_URL: '',
    TOKEN_DISPOSITIVO: deviceToken,
    MIN_DISPENSE_GAP_S: '0',
    PUERTO_DESCUBRIMIENTO: '0',
    PORT: '8001',
    DASHBOARD_ORIGINS: '',
    COOKIE_SECURE: '0',
    ...config,
  });
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const login = await request(base)('/api/session', 'POST', { password });
  if (!login.ok) throw new Error('el inicio de sesión de prueba falló: ' + (await login.text()));
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  return {
    app,
    base,
    cookie,
    call: request(base, cookie),
    close: async () => {
      await app.close();
      for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
      Object.assign(process.env, old);
    },
  };
}

export async function python(dir: string, device: string) {
  const child = spawn(
    'python3',
    [resolve('../../scripts/legacy/reference-server.py'), dir, device, device, deviceToken],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const read = createInterface({ input: child.stdout });
  const port = await Promise.race([
    once(read, 'line').then(([line]) => line as string),
    once(child, 'exit').then(([code]) => {
      throw new Error('referencia Python terminó (' + code + ')');
    }),
  ]);
  read.close();
  const base = 'http://127.0.0.1:' + port;
  return {
    base,
    call: request(base),
    close: async () => {
      child.kill();
      await once(child, 'exit');
    },
  };
}

export async function consume(response: Response, matches: (buffer: Buffer) => boolean) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('respuesta sin cuerpo');
  let result = Buffer.alloc(0);
  try {
    while (!matches(result)) {
      const part = await reader.read();
      if (part.done) throw new Error('flujo interrumpido antes de recibir los datos');
      result = Buffer.concat([result, part.value]);
    }
    return result;
  } finally {
    await reader.cancel();
  }
}
