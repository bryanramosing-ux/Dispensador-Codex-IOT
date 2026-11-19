import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { connect } from 'mqtt';
import { firebaseAdmin } from '../src/lib/server/firebase-admin.ts';
import { mqttSettings } from '../src/lib/server/mqtt-settings.ts';

const publicSettings = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

const checks = [
  ['Firebase Authentication', async () => {
    for (const field of publicSettings) {
      if (!process.env[field]) throw new Error('Configura ' + field + '.');
    }
    await getAuth(firebaseAdmin()).listUsers(1);
  }],
  ['Cloud Firestore', async () => {
    await getFirestore(firebaseAdmin()).collection('settings').doc('dashboard').get();
  }],
  ['Broker MQTT/TLS', async () => {
    const { url, options, subscriptions } = mqttSettings();
    const client = connect(url, { ...options, reconnectPeriod: 0 });
    const connected = new Promise<void>((resolve, reject) => {
      client.once('connect', () => resolve());
      client.on('error', reject);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const grants = await Promise.race([
        connected.then(() => client.subscribeAsync(subscriptions, { qos: 0 })),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('El broker no confirmó la conexión y las suscripciones.')), 15_000);
        }),
      ]);
      if (grants.length !== subscriptions.length || grants.some((grant) => grant.qos !== 0)) {
        throw new Error('Revisa los permisos de suscripción de MQTT_USERNAME.');
      }
    } finally {
      clearTimeout(timer);
      await client.endAsync(true);
    }
  }],
] as const;

for (const [service, check] of checks) {
  try {
    await check();
    console.log(service + ' · OK');
  } catch (error) {
    console.error(service + ' · ' + (error instanceof Error ? error.message : 'Conexión fallida.'));
    process.exitCode = 1;
  }
}
