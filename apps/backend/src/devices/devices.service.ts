import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createSocket, type Socket } from 'node:dgram';
import { Config, localIp } from '../config/config';
import { type JsonObject, utc } from '../config/http';
import { HistoryService } from '../history/history.service';
import { LocalStore } from '../persistence/local-store';
import { SseService } from '../events/sse.service';

export interface Photo {
  name: string;
  size: number;
  ts: string;
}
export interface StoredDevice {
  data: JsonObject;
  seen: number;
  ip: string;
}

@Injectable()
export class DevicesService implements OnModuleInit, OnModuleDestroy {
  readonly started = Date.now();
  esp32?: StoredDevice;
  espOnline = false;
  camera?: { data: JsonObject; seen: number };
  cameraOnline = false;
  private readonly logger = new Logger(DevicesService.name);
  private timer?: NodeJS.Timeout;
  private udp?: Socket;
  private udpReplies = 0;
  private udpWindow = 0;

  constructor(
    private readonly config: Config,
    private readonly store: LocalStore,
    private readonly history: HistoryService,
    private readonly sse: SseService,
  ) {
    this.esp32 = this.store.get<StoredDevice>('device_status', 'esp32');
  }

  get uptime() {
    return Math.max(0, Math.floor((Date.now() - this.started) / 1000));
  }
  get deviceBase() {
    return this.config.deviceUrl || (this.espOnline && this.esp32 ? 'http://' + this.esp32.ip : '');
  }
  get cameraBase() {
    return this.config.cameraUrl || this.deviceBase;
  }
  get autoCapture() {
    return this.store.get<{ auto_capture_s: number }>('settings', 'dashboard')?.auto_capture_s ?? 0;
  }

  snapshot(now = Date.now()) {
    const age = (timestamp?: number) =>
      timestamp ? Math.max(0, Math.round((now - timestamp) / 100) / 10) : null;
    return {
      ts: utc(now),
      backend_uptime_s: this.uptime,
      esp32: {
        online: this.espOnline,
        age_s: age(this.esp32?.seen),
        ip: this.esp32?.ip ?? '',
        data: this.espOnline ? this.esp32?.data : null,
        last_data: this.espOnline ? null : (this.esp32?.data ?? null),
      },
      camera: {
        online: this.cameraOnline,
        age_s: age(this.camera?.seen),
        url: this.cameraBase,
        data: this.cameraOnline ? this.camera?.data : null,
      },
      auto_capture_s: this.autoCapture,
      max_portions: this.config.env.MAX_PORCIONES,
      remote_commands: Boolean(this.config.env.TOKEN_DISPOSITIVO),
      last_photo: this.store.page<Photo>('photos', 1).items[0] ?? null,
    };
  }

  publish() {
    this.sse.publish('status', this.snapshot());
  }

  setCamera(online: boolean, data?: JsonObject) {
    const changed = online !== this.cameraOnline;
    if (changed || data) {
      const now = Date.now();
      const previous =
        this.camera ?? this.store.get<{ seen: number; data: JsonObject }>('device_status', 'camera');
      const current = data ? { data, seen: now } : previous;
      if (changed || JSON.stringify(current?.data) !== JSON.stringify(previous?.data)) {
        this.history.atomic((tx, add) => {
          tx.set('device_status', 'camera', now, {
            online,
            data: current?.data ?? null,
            seen: current?.seen ?? null,
          });
          if (changed) add('conexion', online ? 'ESP32-CAM conectada' : 'ESP32-CAM sin comunicación');
        }, now);
      }
      if (data) this.camera = { data, seen: now };
      this.cameraOnline = online;
    }
    this.publish();
  }

  watchdog(now = Date.now()) {
    if (this.espOnline && this.esp32 && now - this.esp32.seen > this.config.env.ESP32_OFFLINE_S * 1000) {
      const previous = this.esp32;
      this.history.atomic((tx, add) => {
        tx.set('device_status', 'esp32', now, { ...previous, online: false });
        add('conexion', 'ESP32 sin comunicación');
      }, now);
      this.espOnline = false;
    }
    this.publish();
  }

  onModuleInit() {
    const previousEsp = this.store.get<JsonObject>('device_status', 'esp32');
    const previousCamera = this.store.get<JsonObject>('device_status', 'camera');
    const previousDevices = [
      ['esp32', previousEsp],
      ['camera', previousCamera],
    ] as const;
    this.store.atomic((tx) => {
      for (const [id, previous] of previousDevices) {
        if (previous?.online === true)
          tx.set('device_status', id, Date.now(), { ...previous, online: false });
      }
    });
    this.timer = setInterval(() => {
      try {
        this.watchdog();
      } catch {
        this.logger.error('No se pudo comprobar el estado del ESP32');
      }
    }, 2000);
    if (!this.config.env.PUERTO_DESCUBRIMIENTO) return;
    const udp = createSocket('udp4');
    this.udp = udp;
    udp.on('error', (error) =>
      this.logger.warn('UDP de descubrimiento: ' + (error as NodeJS.ErrnoException).code),
    );
    udp.on('message', (data, address) => {
      if (
        data.length > 64 ||
        data.toString('ascii').trim() !== 'DISPENSADOR?' ||
        !localIp(address.address, this.config.test) ||
        (this.config.deviceIp && address.address !== this.config.deviceIp)
      )
        return;
      const now = Date.now();
      if (now > this.udpWindow) {
        this.udpWindow = now + 1000;
        this.udpReplies = 0;
      }
      if (++this.udpReplies <= 10)
        udp.send('DISPENSADOR!' + this.config.env.PORT, address.port, address.address);
    });
    udp.bind(this.config.env.PUERTO_DESCUBRIMIENTO);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    if (this.udp) {
      try {
        this.udp.close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error;
      }
    }
  }
}
