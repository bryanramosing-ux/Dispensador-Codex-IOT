import { Global, Injectable, Module } from '@nestjs/common';
import dotenv from 'dotenv';
import { isIPv4 } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export function localIp(ip: string, allowLoopback = false): boolean {
  if (!isIPv4(ip)) return false;
  const [first, second] = ip.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (allowLoopback && ip === '127.0.0.1')
  );
}

export function edgeUrl(value: string, allowLoopback = false): string {
  if (!value) return '';
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !localIp(url.hostname, allowLoopback) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('se requiere un origen HTTP con IPv4 privada, sin ruta ni credenciales');
  }
  return url.origin;
}

const integer = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const seconds = (min: number, max: number, fallback: number) =>
  z.coerce.number().min(min).max(max).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z
    .string()
    .regex(/^(localhost|[0-9a-f:.]+)$/i)
    .default('0.0.0.0'),
  PORT: integer(1, 65535, 8001),
  PUERTO_DESCUBRIMIENTO: integer(0, 65535, 41234),
  ESP32_CAM_URL: z.string().default('http://192.168.1.51'),
  ESP32_URL: z.string().default(''),
  TOKEN_DISPOSITIVO: z
    .string()
    .regex(/^[\x21-\x7e]*$/)
    .max(64)
    .default(''),
  ADMIN_PASSWORD: z.string().min(16).max(240),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_S: integer(60, 86400, 28800),
  COOKIE_SECURE: z.enum(['0', '1']).default('0'),
  DASHBOARD_ORIGINS: z.string().default(''),
  ESP32_OFFLINE_S: seconds(2, 300, 15),
  CAMERA_POLL_S: seconds(1, 300, 5),
  MIN_DISPENSE_GAP_S: seconds(0, 300, 3),
  MAX_PORCIONES: integer(1, 3, 3),
  STORAGE_DIR: z.string().min(1).default('.data'),
  FIREBASE_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]{4,29}$/),
  FIREBASE_STORAGE_BUCKET: z
    .union([z.literal(''), z.string().regex(/^[a-z0-9][a-z0-9._-]{2,220}$/)])
    .default(''),
});

const repositoryRoot = resolve(__dirname, '../../../..');

@Injectable()
export class Config {
  readonly env: z.infer<typeof envSchema>;
  readonly cameraUrl: string;
  readonly deviceUrl: string;
  readonly deviceIp: string;
  readonly origins: Set<string>;
  readonly storageDir: string;
  readonly frontendDir = resolve(repositoryRoot, 'apps/frontend/dist');
  readonly test: boolean;

  constructor() {
    const envPath = resolve(repositoryRoot, '.env');
    if (process.env.NODE_ENV !== 'test' && existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(
        'Variables de entorno inválidas: ' +
          result.error.issues.map((issue) => issue.path.join('.')).join(', '),
      );
    }
    this.env = result.data;
    this.test = this.env.NODE_ENV === 'test';
    this.cameraUrl = this.checkedUrl('ESP32_CAM_URL');
    this.deviceUrl = this.checkedUrl('ESP32_URL');
    this.deviceIp = this.deviceUrl ? new URL(this.deviceUrl).hostname : '';
    this.origins = new Set(
      this.env.DASHBOARD_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    );
    for (const origin of this.origins) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new Error('DASHBOARD_ORIGINS contiene un origen inválido');
      }
      if (!['http:', 'https:'].includes(url.protocol) || origin !== url.origin) {
        throw new Error('DASHBOARD_ORIGINS requiere orígenes HTTP(S) exactos');
      }
    }
    this.storageDir = resolve(repositoryRoot, this.env.STORAGE_DIR);
  }

  private checkedUrl(name: 'ESP32_CAM_URL' | 'ESP32_URL') {
    try {
      return edgeUrl(this.env[name], this.test);
    } catch {
      throw new Error(name + ' requiere un origen HTTP con IPv4 privada');
    }
  }
}

@Global()
@Module({ providers: [Config], exports: [Config] })
export class ConfigModule {}
