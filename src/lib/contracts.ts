import { z } from 'zod';

export const MAX_PORTIONS = 3;
export const MAX_FRAME_BYTES = 400_000;
export const ONLINE_MS = { esp32: 50_000, camera: 90_000 };
export const COMMAND_TTL_SECONDS = 8;
export const COMMAND_GAP_MS = 4_000;

export const uuid = z.uuid().transform((id) => id.toLowerCase());
export const commandInput = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('dispense'),
    portions: z.number().int().min(1).max(MAX_PORTIONS),
    confirm: z.literal(true),
    id: uuid,
  }),
  z.object({ operation: z.literal('reset-errors'), id: uuid }),
]);
export const commandAck = z.object({
  id: uuid,
  ok: z.boolean(),
  resultado: z.string().regex(/^[A-Z0-9_]{1,48}$/),
  cooldown_s: z.number().int().nonnegative().optional(),
});
export const captureInterval = z.object({
  interval_s: z.number().int().refine((value) => value === 0 || (value >= 10 && value <= 3600)),
});
export const photoName = /^foto_\d{8}_\d{6}_[0-9a-f]{6,32}\.jpg$/;

const scalar = z.union([z.string().max(160), z.number(), z.boolean(), z.null()]);
export const dispenserData = z.object({
  dispositivo: z.literal('ESP32'),
  estado: z.string().min(1).max(64),
  error: z.string().max(64).optional(),
  dispensando: z.boolean().optional(),
  nivel_tolva: z.number().min(-1).max(100).optional(),
  sensor_nivel_ok: z.boolean().optional(),
  dispensaciones_total: z.number().int().nonnegative().optional(),
  dispensaciones_24h: z.number().int().nonnegative().optional(),
  rssi: z.number().optional(),
  cooldown_s: z.number().int().nonnegative().optional(),
  max_porciones: z.number().int().positive().optional(),
  ultima_dispensacion_hace_s: z.number().int().min(-1).optional(),
  alerta_tolva: z.string().max(64).optional(),
  servo: z.string().max(64).optional(),
  ultimo_origen: z.string().max(64).optional(),
  ultimas_porciones: z.number().int().nonnegative().optional(),
  ultimo_resultado: z.string().max(64).optional(),
  v_bateria: z.number().optional(),
  v_servo: z.number().optional(),
  uptime_s: z.number().int().nonnegative().optional(),
}).catchall(scalar);
export const cameraData = z.object({
  camara: z.boolean(),
  resolucion: z.string().max(64).optional(),
  fotos_ok: z.number().int().nonnegative().optional(),
  fotos_fallidas: z.number().int().nonnegative().optional(),
  rssi: z.number().optional(),
}).catchall(scalar);
export const alertData = z.object({
  tipo: z.string().regex(/^[A-Z0-9_]{1,48}$/),
  nivel: z.number().min(-1).max(100),
});

export function envelope<T extends z.ZodType>(data: T) {
  return z.object({ sentAt: z.number().int().positive(), data });
}

export function isRecent(sentAt: number, nowMs: number) {
  const offset = nowMs - sentAt * 1000;
  return offset >= -10_000 && offset < 45_000;
}

export function deviceOnline(seen: number | undefined, kind: keyof typeof ONLINE_MS, nowMs: number) {
  return typeof seen === 'number' && seen <= nowMs && nowMs - seen < ONLINE_MS[kind];
}

export function isJpeg(payload: Uint8Array) {
  return payload.length >= 4 && payload.length <= MAX_FRAME_BYTES &&
    payload[0] === 0xff && payload[1] === 0xd8 &&
    payload.at(-2) === 0xff && payload.at(-1) === 0xd9;
}

export function topics(siteId: string) {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(siteId)) throw new Error('MQTT_SITE_ID inválido');
  const root = 'dispensador/' + siteId;
  return {
    telemetry: root + '/esp32/telemetry',
    alert: root + '/esp32/alert',
    command: root + '/esp32/command',
    ack: root + '/esp32/ack',
    cameraStatus: root + '/camera/status',
    cameraRequest: root + '/camera/request',
    cameraFrame: root + '/camera/frame/',
  };
}

export type CommandInput = z.infer<typeof commandInput>;
export type CommandAck = z.infer<typeof commandAck>;
export type CommandResult = { id: string; state: 'pending' | 'accepted' | 'rejected' | 'outcome_unknown'; result?: string };
export type DispenserData = z.infer<typeof dispenserData>;
export type CameraData = z.infer<typeof cameraData>;
export type DeviceStatus<T> = { online: boolean; seen: number | null; data: T | null };
export type HistoryEntry = { id: string; ts: string; tipo: string; mensaje: string };
export type Photo = { name: string; ts: string; size: number };
export type Page<T> = { items: T[]; next: string | null };
export type Dashboard = {
  esp32: DeviceStatus<DispenserData>;
  camera: DeviceStatus<CameraData>;
  mqtt: boolean;
  autoCapture: number;
};
