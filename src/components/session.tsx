'use client';

import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { useEffect, useState, type FormEvent } from 'react';
import { api, browserAuth } from '@/lib/firebase-client';
import { Panel } from './panel';

export function Session() {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<'loading' | 'login' | 'operator' | 'denied' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let revision = 0;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    Promise.resolve().then(browserAuth).then((auth) => {
      if (!active) return;
      unsubscribe = onAuthStateChanged(auth, (current) => {
        const requestId = ++revision;
        setUser(current);
        setState(current ? 'loading' : 'login');
        if (!current) return;
        api(current, 'session').then(() => {
          if (requestId === revision) setState('operator');
        }).catch((error: Error) => {
          if (requestId !== revision) return;
          setMessage(error.message);
          setState('denied');
        });
      });
    }).catch((error: Error) => {
      if (!active) return;
      setMessage(error.message);
      setState('error');
    });
    return () => {
      active = false;
      revision++;
      unsubscribe?.();
    };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setMessage('');
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(browserAuth(), String(fields.get('email')).trim(), String(fields.get('password')));
    } catch (error) {
      const code = (error as { code?: string }).code;
      setMessage(code === 'auth/network-request-failed'
        ? 'No se pudo conectar con Firebase Authentication.'
        : code === 'auth/too-many-requests' ? 'Demasiados intentos. Vuelve a intentarlo más tarde.'
        : 'El correo o la contraseña son incorrectos.');
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    setMessage('');
    await signOut(browserAuth());
  }

  if (state === 'operator' && user) return <Panel user={user} onLogout={logout} />;

  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <span className="brand-icon" aria-hidden="true">D</span>
      <h1 id="login-title">Dispensador IoT</h1>
      {state === 'loading' && <p role="status">Verificando sesión…</p>}
      {state === 'login' && <form onSubmit={login}>
        <p>Inicia sesión para monitorear y controlar el dispensador.</p>
        <label>Correo electrónico<input name="email" type="email" autoComplete="username" required /></label>
        <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="primary" disabled={submitting}>{submitting ? 'Ingresando…' : 'Iniciar sesión'}</button>
      </form>}
      {message && <p className="notice error" role="alert">{message}</p>}
      {state === 'denied' && <button onClick={() => void logout()}>Cerrar sesión</button>}
    </section>
  </main>;
}
