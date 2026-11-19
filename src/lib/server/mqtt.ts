import 'server-only';
import { readFileSync } from 'node:fs';
import { connect, type MqttClient } from 'mqtt';
import { alertData, cameraData, commandAck, dispenserData, envelope, isRecent, MAX_FRAME_BYTES, topics, uuid, type CommandAck } from '@/lib/contracts';
import { storeAlert, storeSample } from './store';

const espSample = envelope(dispenserData);
const cameraSample = envelope(cameraData);
const alertSample = envelope(alertData);

function parseJson(payload: Buffer) {
  if (payload.length > 4096) return null;
  try {
    return JSON.parse(payload.toString()) as unknown;
  } catch {
    return null;
  }
}

export function isJpeg(payload: Buffer) {
  return payload.length >= 4 && payload.length <= MAX_FRAME_BYTES &&
    payload[0] === 0xff && payload[1] === 0xd8 &&
    payload.at(-2) === 0xff && payload.at(-1) === 0xd9;
}

class Broker {
  private readonly names: ReturnType<typeof topics>;
  private readonly client: MqttClient;
  private subscribed = false;
  private pendingWrites = 0;
  private writes = Promise.resolve();
  private readonly commands = new Map<string, (value?: CommandAck) => void>();
  private readonly frames = new Map<string, (value?: Buffer) => void>();

  constructor(url: URL) {
    this.names = topics(process.env.MQTT_SITE_ID ?? '');
    const username = process.env.MQTT_USERNAME;
    const password = process.env.MQTT_PASSWORD;
    if (!username || !password || url.username || url.password) {
      throw new Error('Configure MQTT_USERNAME y MQTT_PASSWORD fuera de MQTT_URL.');
    }
    if (url.protocol !== 'mqtts:' && url.protocol !== 'wss:') throw new Error('MQTT_URL requiere TLS.');
    const ca = process.env.MQTT_CA_FILE ? readFileSync(process.env.MQTT_CA_FILE) : undefined;
    this.client = connect(url.toString(), {
      username, password, ca, rejectUnauthorized: true,
      clean: true, queueQoSZero: false, resubscribe: false, reconnectPeriod: 3_000, connectTimeout: 8_000,
    });
    this.client.on('connect', () => {
      const { telemetry, alert, ack, cameraStatus, cameraFrame } = this.names;
      this.client.subscribe([telemetry, alert, ack, cameraStatus, cameraFrame + '+'], { qos: 0 }, (error, grants) => {
        this.subscribed = !error && grants?.length === 5 && grants.every((grant) => grant.qos === 0);
        if (!this.subscribed) console.error('El broker MQTT rechazó una suscripción.');
      });
    });
    this.client.on('close', () => { this.subscribed = false; });
    this.client.on('error', (error) => {
      console.error('Error MQTT', (error as { code?: string }).code ?? error.name);
    });
    this.client.on('message', (topic, payload, packet) => {
      if (!packet.retain) this.receive(topic, payload);
    });
  }

  get ready() {
    return this.client.connected && this.subscribed;
  }

  private receive(topic: string, payload: Buffer) {
    const names = this.names;
    if (topic.startsWith(names.cameraFrame)) {
      const id = uuid.safeParse(topic.slice(names.cameraFrame.length));
      if (id.success && isJpeg(payload)) this.frames.get(id.data)?.(payload);
      return;
    }
    const json = parseJson(payload);
    if (topic === names.ack) {
      const ack = commandAck.safeParse(json);
      if (ack.success) this.commands.get(ack.data.id)?.(ack.data);
      return;
    }
    const at = Date.now();
    if (topic === names.telemetry) {
      const item = espSample.safeParse(json);
      if (item.success && isRecent(item.data.sentAt, at)) this.persist(() => storeSample('esp32', item.data, at));
    } else if (topic === names.cameraStatus) {
      const item = cameraSample.safeParse(json);
      if (item.success && isRecent(item.data.sentAt, at)) this.persist(() => storeSample('camera', item.data, at));
    } else if (topic === names.alert) {
      const item = alertSample.safeParse(json);
      if (item.success && isRecent(item.data.sentAt, at)) this.persist(() => storeAlert(item.data.data, at));
    }
  }

  private persist(write: () => Promise<void>) {
    if (this.pendingWrites >= 32) return;
    this.pendingWrites++;
    this.writes = this.writes.then(write).catch((error) => {
      console.error('Error al guardar mensaje MQTT', (error as { code?: unknown })?.code ?? (error as Error)?.name);
    }).finally(() => { this.pendingWrites--; });
  }

  private request<T>(pending: Map<string, (value?: T) => void>, topic: string, payload: { id: string; expiresAt: number }) {
    if (!this.ready || Date.now() >= payload.expiresAt * 1000 || pending.has(payload.id)) {
      return Promise.resolve(undefined);
    }
    return new Promise<T | undefined>((resolve) => {
      const finish = (value?: T) => {
        clearTimeout(timer);
        pending.delete(payload.id);
        resolve(value);
      };
      const wait = Math.max(1, payload.expiresAt * 1000 + 2000 - Date.now());
      const timer = setTimeout(finish, wait);
      pending.set(payload.id, finish);
      this.client.publish(topic, JSON.stringify(payload), { qos: 0, retain: false }, (error) => {
        if (error) finish();
      });
    });
  }

  command(payload: { id: string; expiresAt: number; operation: string; portions: number | null }) {
    return this.request(this.commands, this.names.command, payload);
  }

  frame(id: string, expiresAt: number) {
    return this.request(this.frames, this.names.cameraRequest, { id, expiresAt });
  }
}

const state = globalThis as typeof globalThis & { dispenserBroker?: Broker };

export function broker() {
  if (!state.dispenserBroker && process.env.MQTT_URL) state.dispenserBroker = new Broker(new URL(process.env.MQTT_URL));
  return state.dispenserBroker;
}
