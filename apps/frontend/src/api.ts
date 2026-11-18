export interface Photo {
  name: string;
  size: number;
  ts: string;
}
export interface HistoryEntry {
  id: number;
  ts: string;
  tipo: string;
  mensaje: string;
}
export interface Telemetry {
  estado?: string;
  error?: string;
  wifi_conectado?: boolean;
  rssi?: number;
  backend?: boolean;
  sensor_nivel_ok?: boolean;
  nivel_tolva?: number;
  alerta_tolva?: string;
  distancia_nivel_cm?: number;
  servo?: string;
  dispensando?: boolean;
  pulso_servo_us?: number;
  ultima_dispensacion_hace_s?: number;
  ultimas_porciones?: number;
  ultimo_origen?: string;
  dispensaciones_total?: number;
  uptime_s?: number;
  cooldown_s?: number;
  ultimo_resultado?: string;
  dispensaciones_24h?: number;
}
export interface Status {
  ts: string;
  backend_uptime_s: number;
  auto_capture_s: number;
  max_portions: number;
  remote_commands: boolean;
  last_photo: Photo | null;
  esp32: {
    online: boolean;
    age_s: number | null;
    ip: string;
    data: Telemetry | null;
    last_data: Telemetry | null;
  };
  camera: {
    online: boolean;
    age_s: number | null;
    url: string;
    data: {
      stream?: boolean;
      camara_res?: string;
      resolucion?: string;
      fotos_ok?: number;
      fotos_fallidas?: number;
    } | null;
  };
}
interface Reply {
  error?: string;
  resultado?: string;
}

export const sessionExpired = new EventTarget();
export async function api<T extends object = Reply>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: object,
  extra?: Record<string, string>,
) {
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'dashboard',
        ...(body && { 'Content-Type': 'application/json' }),
        ...extra,
      },
      body: body && JSON.stringify(body),
    });
    if (response.status === 401 && path !== '/api/session') sessionExpired.dispatchEvent(new Event('expire'));
    const data: Partial<T> & Reply = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data, cursor: response.headers.get('X-Next-Cursor') };
  } catch {
    return {
      ok: false,
      status: 0,
      data: { error: 'No hay conexión con el servidor local.' } as Partial<T> & Reply,
      cursor: null,
    };
  }
}

export function photoUrl(name: string, download = false) {
  return '/api/gallery/' + encodeURIComponent(name) + (download ? '?download=1' : '');
}

export function commandKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function formatTime(seconds?: number | null) {
  if (seconds == null || seconds < 0) return '—';
  const s = Math.floor(seconds),
    d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  return (d ? d + ' d ' : '') + (h || d ? h + ' h ' : '') + m + ' min' + (s < 60 ? ' ' + s + ' s' : '');
}
export function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
