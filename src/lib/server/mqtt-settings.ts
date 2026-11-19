import { readFileSync } from 'node:fs';
import { topics } from '../contracts.ts';

export function mqttSettings() {
  if (!process.env.MQTT_URL) throw new Error('Configura MQTT_URL con el endpoint TLS del broker.');
  const url = new URL(process.env.MQTT_URL);
  if (url.protocol !== 'mqtts:' && url.protocol !== 'wss:') {
    throw new Error('MQTT_URL debe usar mqtts:// o wss://.');
  }
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  if (!username || !password || url.username || url.password) {
    throw new Error('Configura MQTT_USERNAME y MQTT_PASSWORD fuera de MQTT_URL.');
  }

  const names = topics(process.env.MQTT_SITE_ID ?? '');
  return {
    url: url.toString(),
    names,
    subscriptions: [names.telemetry, names.alert, names.ack, names.cameraStatus, names.cameraFrame + '+'],
    options: {
      username,
      password,
      ca: process.env.MQTT_CA_FILE ? readFileSync(process.env.MQTT_CA_FILE) : undefined,
      rejectUnauthorized: true,
      clean: true,
      queueQoSZero: false,
      resubscribe: false,
      reconnectPeriod: 3_000,
      connectTimeout: 8_000,
    },
  };
}
