'use client';

import { getApps, initializeApp } from 'firebase/app';
import { getAuth, type Auth, type User } from 'firebase/auth';

let auth: Auth | undefined;

export function browserAuth() {
  if (auth) return auth;
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(config).some((value) => !value)) {
    throw new Error('Completa la configuración web de Firebase en .env.local.');
  }
  const app = getApps().find((candidate) => candidate.name === '[DEFAULT]') ?? initializeApp(config);
  auth = getAuth(app);
  return auth;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function request(user: User, path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + await user.getIdToken());
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch('/api/' + path, { ...options, headers, cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error ?? 'El servidor no pudo completar la operación.');
  }
  return response;
}

export async function api<T>(user: User, path: string, options?: RequestInit): Promise<T> {
  return (await request(user, path, options)).json();
}

export function dateLabel(iso: string | number) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Fecha desconocida'
    : new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium' }).format(date);
}
