import { z } from 'zod';
import { DtoPipe, validKeys } from '../config/http';

const text = z.string().max(255);
const number = z.number();
const count = number.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const known = {
  fw: text,
  modo: text,
  estado: text,
  error: text,
  ip: text,
  alerta_tolva: text,
  servo: text,
  ultimo_origen: text,
  ultimo_resultado: text,
  ultimo_motivo: text,
  wifi_conectado: z.boolean(),
  backend: z.boolean(),
  sensor_nivel_ok: z.boolean(),
  alerta_pendiente: z.boolean(),
  dispensando: z.boolean(),
  rssi: number,
  distancia_nivel_cm: number,
  nivel_tolva: number,
  pulso_servo_us: count,
  dispensaciones_total: count,
  dispensaciones_24h: count,
  ultima_dispensacion_hace_s: number,
  ultimas_porciones: count,
  cooldown_s: count,
  max_porciones: count,
  distancia_cm: number,
  ultima_clase: number,
  ultima_confianza: number,
  raciones_perro: count,
  raciones_gato: count,
  raciones_manual: count,
  v_servo: number,
  v_bateria: number,
  uptime_s: count,
  heap: count,
};
export const telemetrySchema = z
  .object(known)
  .partial()
  .extend({ dispositivo: z.literal('ESP32') })
  .catchall(z.union([z.string(), number, z.boolean(), z.null()]))
  .refine(validKeys);
export type TelemetryDto = z.infer<typeof telemetrySchema>;
export const telemetryPipe = new DtoPipe(telemetrySchema, (body) =>
  body.dispositivo === 'ESP32' ? 'campo de telemetría inválido' : 'dispositivo desconocido',
);

const alertSchema = z.object({
  dispositivo: z.literal('ESP32').optional(),
  tipo: z
    .string()
    .transform((value) => value.slice(0, 32))
    .pipe(z.string().regex(/^[A-Z_]{1,32}$/)),
  nivel: number.optional(),
});
export type AlertDto = z.infer<typeof alertSchema>;
export const alertPipe = new DtoPipe(alertSchema, () => 'tipo de alerta inválido');
