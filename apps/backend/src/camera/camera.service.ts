import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Response } from 'express';
import { Config } from '../config/config';
import { fail, edgeObject, utc } from '../config/http';
import { DevicesService, type Photo } from '../devices/devices.service';
import { edgeRequest, MAX_PHOTO } from '../devices/edge-http';
import { HistoryService } from '../history/history.service';
import { LocalStore } from '../persistence/local-store';
import { MJPEG_TYPE, upstreamFrames } from './mjpeg';

export const PHOTO_NAME = /^foto_\d{8}_\d{6}_[0-9a-f]{6}\.jpg$/;
type Release = () => void;

class CameraSlot {
  private busy = false;
  private readonly waiting: Array<(release: Release) => void> = [];
  private readonly release = () => {
    const next = this.waiting.shift();
    if (next) next(this.release);
    else this.busy = false;
  };

  async acquire(signal: AbortSignal): Promise<Release> {
    signal.throwIfAborted();
    if (!this.busy) {
      this.busy = true;
      return this.release;
    }
    if (this.waiting.length >= 8) throw new Error('cámara ocupada');
    return new Promise((resolve, reject) => {
      const abort = () => {
        const position = this.waiting.indexOf(grant);
        if (position >= 0) this.waiting.splice(position, 1);
        reject(new Error('cámara ocupada'));
      };
      const grant = (release: Release) => {
        signal.removeEventListener('abort', abort);
        resolve(release);
      };
      this.waiting.push(grant);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
}

@Injectable()
export class CameraService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CameraService.name);
  private readonly slot = new CameraSlot();
  private readonly viewers = new Map<Response, () => boolean>();
  private readonly shutdown = new AbortController();
  private broker?: AbortController;
  private timer?: NodeJS.Timeout;
  private lastAuto = Date.now();
  private polling = false;

  constructor(
    private readonly config: Config,
    private readonly devices: DevicesService,
    private readonly store: LocalStore,
    private readonly history: HistoryService,
  ) {}

  onModuleInit() {
    if (!this.config.test)
      this.timer = setInterval(() => void this.background(), this.config.env.CAMERA_POLL_S * 1000);
  }
  onModuleDestroy() {
    this.shutdown.abort();
    clearInterval(this.timer);
    for (const response of this.viewers.keys()) response.end();
  }

  private async get(path: '/capture' | '/status', timeout: number) {
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(timeout)]);
    const release = await this.slot.acquire(signal);
    try {
      return await edgeRequest(this.devices.cameraBase, path, {
        timeout,
        signal,
        limit: path === '/capture' ? MAX_PHOTO : 8192,
      });
    } finally {
      release();
    }
  }

  async poll() {
    let online = false;
    let data;
    try {
      const incoming = await this.get('/status', 3000);
      const body: unknown = JSON.parse(incoming.body.toString());
      if (incoming.status === 200 && edgeObject(body)) {
        data = body;
        online = Boolean(body.camara);
      }
    } catch {
      if (this.shutdown.signal.aborted) return false;
    }
    this.devices.setCamera(online, data);
    return online;
  }

  private async background() {
    if (this.polling) return;
    this.polling = true;
    try {
      const online = await this.poll();
      const interval = this.devices.autoCapture;
      if (
        !this.shutdown.signal.aborted &&
        online &&
        interval &&
        Date.now() - this.lastAuto >= interval * 1000
      ) {
        this.lastAuto = Date.now();
        await this.capture('automática');
      }
    } catch {
      if (!this.shutdown.signal.aborted) {
        this.logger.warn('No se pudo completar el ciclo de cámara');
        try {
          this.history.log('error', 'Captura automática fallida');
        } catch {
          this.logger.error('No se pudo registrar el error de captura');
        }
      }
    } finally {
      this.polling = false;
    }
  }

  async frame() {
    let incoming: Awaited<ReturnType<CameraService['get']>>;
    try {
      incoming = await this.get('/capture', 8000);
    } catch {
      fail(503, 'cámara no disponible');
    }
    if (incoming.status !== 200) fail(incoming.status === 409 ? 409 : 503, 'cámara: HTTP ' + incoming.status);
    if (incoming.body[0] !== 0xff || incoming.body[1] !== 0xd8) fail(503, 'JPEG inválido');
    return incoming.body;
  }

  async capture(origin: 'manual' | 'automática') {
    const bytes = await this.frame();
    const now = Date.now();
    const ts = utc(now);
    const stamp = ts.slice(0, 10).replaceAll('-', '') + '_' + ts.slice(11, 19).replaceAll(':', '');
    let name: string;
    do {
      name = 'foto_' + stamp + '_' + randomBytes(3).toString('hex') + '.jpg';
    } while (this.store.jpeg(name));
    this.history.atomic((tx, add) => {
      tx.putPhoto(name, bytes);
      tx.set('photos', name, now, { name, size: bytes.length, ts });
      add('foto', 'Foto ' + name + ' (' + origin + ', ' + Math.floor(bytes.length / 1024) + ' kB)');
    }, now);
    this.devices.publish();
    return { name, size: bytes.length };
  }

  delete(name: string) {
    if (!PHOTO_NAME.test(name) || !this.store.get<Photo>('photos', name)) fail(404, 'foto no encontrada');
    this.history.atomic((tx, add) => {
      tx.deletePhoto(name);
      add('foto', 'Foto ' + name + ' eliminada');
    });
    this.devices.publish();
  }

  setAuto(seconds: number) {
    this.history.atomic((tx, add) => {
      tx.set('settings', 'dashboard', Date.now(), { auto_capture_s: seconds });
      add('estado', 'Captura automática: ' + (seconds ? 'cada ' + seconds + ' s' : 'desactivada'));
    });
    this.devices.publish();
  }

  stream(res: Response, authorize: () => boolean) {
    if (!this.devices.cameraOnline) fail(503, 'cámara desconectada', false);
    if (this.viewers.size >= 6) fail(429, 'capacidad de MJPEG agotada');
    res.set({ 'Content-Type': MJPEG_TYPE, 'X-Accel-Buffering': 'no' });
    res.on('close', () => this.remove(res));
    this.viewers.set(res, authorize);
    res.flushHeaders();
    if (!this.broker) void this.runStream();
  }

  private remove(res: Response) {
    this.viewers.delete(res);
    if (!this.viewers.size) this.broker?.abort();
  }

  private async runStream() {
    this.broker = new AbortController();
    const signal = AbortSignal.any([this.broker.signal, this.shutdown.signal]);
    let failures = 0;
    try {
      while (this.viewers.size && failures < 5 && !signal.aborted) {
        let received = false;
        let release: Release | undefined;
        try {
          release = await this.slot.acquire(AbortSignal.any([signal, AbortSignal.timeout(5000)]));
          for await (const frame of upstreamFrames(this.devices.cameraBase, signal)) {
            received = true;
            for (const [res, authorized] of this.viewers) {
              if (!authorized()) {
                this.remove(res);
                res.end();
              } else if (res.writableNeedDrain || res.destroyed || res.writableEnded) {
                this.remove(res);
                res.destroy();
              } else res.write(frame);
            }
          }
        } catch {
          if (signal.aborted) break;
        } finally {
          release?.();
        }
        failures = received ? 0 : failures + 1;
        await delay(received ? 25 : 500, undefined, { signal }).catch(() => undefined);
      }
    } finally {
      this.broker = undefined;
      if (failures >= 5) {
        for (const res of this.viewers.keys()) res.end();
        this.viewers.clear();
      } else if (this.viewers.size && !this.shutdown.signal.aborted) void this.runStream();
    }
  }
}
