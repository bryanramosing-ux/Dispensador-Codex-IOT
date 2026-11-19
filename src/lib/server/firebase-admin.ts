import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';

export function firebaseAdmin() {
  // The Admin SDK changes its token verification when a local Auth host is configured.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('La instalación requiere Firebase en la nube. Actualiza .env.local desde .env.example.');
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Configura FIREBASE_PROJECT_ID.');
  const webProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (webProject && webProject !== projectId) {
    throw new Error('Los IDs del proyecto web y Firebase Admin deben coincidir.');
  }

  return getApps().find((app) => app.name === '[DEFAULT]') ??
    initializeApp({ projectId, credential: applicationDefault() });
}
