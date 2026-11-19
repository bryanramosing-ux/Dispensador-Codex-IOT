import 'server-only';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function admin() {
  const existing = getApps().find((app) => app.name === '[DEFAULT]');
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID requerido');
  return initializeApp({
    projectId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    credential: applicationDefault(),
  });
}

export const auth = () => getAuth(admin());
export const db = () => getFirestore(admin());
export const bucket = () => getStorage(admin()).bucket();
