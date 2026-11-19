'use client';

import type { User } from 'firebase/auth';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MAX_PORTIONS, type CommandResult, type Dashboard } from '@/lib/contracts';
import { api, ApiError, dateLabel } from '@/lib/firebase-client';
import { Camera, Gallery, History } from './records';

const views = ['Estado', 'Control', 'Cámara', 'Galería', 'Historial'] as const;

function duration(seconds: number | undefined) {
  if (seconds === undefined || seconds < 0) return '—';
  if (seconds < 60) return seconds + ' s';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min';
  return Math.floor(seconds / 3600) + ' h ' + Math.floor(seconds % 3600 / 60) + ' min';
}

function commandLabel(result: CommandResult) {
  switch (result.state) {
    case 'accepted': return (result.result ?? 'ACEPTADO') + ' · El ESP32 confirmó la solicitud. Revisa el estado o historial para ver la ejecución.';
    case 'rejected': return 'El ESP32 rechazó la solicitud · ' + (result.result ?? '');
    case 'pending': return 'Comando pendiente de respuesta.';
    case 'outcome_unknown': return 'El ESP32 no confirmó el resultado. Revisa la dosis y el historial antes de enviar otra solicitud.';
  }
}

function Metric({ title, value, detail }: { title: string; value: string | number; detail?: string }) {
  return <article className="metric"><p>{title}</p><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

export function Panel({ user, onLogout }: { user: User; onLogout: () => Promise<void> }) {
  const [view, setView] = useState<(typeof views)[number]>('Estado');
  const [status, setStatus] = useState<Dashboard>();
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [portions, setPortions] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ message: string; warn: boolean }>();

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api<Dashboard>(user, 'dashboard', { signal });
      if (!signal?.aborted) {
        setStatus(data);
        setError('');
      }
    } catch (error) {
      if (signal?.aborted) return;
      setStatus(undefined);
      setError((error as Error).message);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setBlocked(true);
    }
  }, [user]);

  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!document.hidden) await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 12_000);
    }
    function onVisible() {
      if (!document.hidden) void refresh(controller.signal);
    }
    void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [blocked, refresh]);

  const data = status?.esp32.online ? status.esp32.data : null;
  const limit = Math.min(MAX_PORTIONS, data?.max_porciones ?? MAX_PORTIONS);
  const ready = Boolean(status?.mqtt && status.esp32.online && !busy);
  const canDispense = ready && !data?.dispensando && !(data?.cooldown_s && data.cooldown_s > 0);
  const level = data?.sensor_nivel_ok && data.nivel_tolva !== undefined && data.nivel_tolva >= 0 ? data.nivel_tolva + '%' : '—';
  async function command(operation: 'dispense' | 'reset-errors', event?: FormEvent) {
    event?.preventDefault();
    if (busy || !ready || (operation === 'dispense' && !canDispense)) return;
    const count = Math.min(portions, limit);
    if (!window.confirm(operation === 'dispense' ? '¿Dispensar ' + count + (count === 1 ? ' porción?' : ' porciones?') : '¿Borrar los errores del ESP32?')) return;
    setBusy(true);
    setResult(undefined);
    try {
      const input = operation === 'dispense' ? { operation, portions: count, confirm: true } : { operation };
      const result = await api<CommandResult>(user, 'commands', {
        method: 'POST',
        body: JSON.stringify({ ...input, id: crypto.randomUUID() }),
      });
      setResult({ message: commandLabel(result), warn: result.state !== 'accepted' });
    } catch (error) {
      const message = error instanceof ApiError && error.status < 500 ? error.message
        : 'El resultado no está confirmado. Revisa el estado y el historial antes de enviar otra solicitud.';
      setResult({ message, warn: true });
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const title = blocked ? 'Acceso al dispensador' : view;
  return <div className="app">
    <header className="site-header">
      <div className="brand"><span className="brand-icon" aria-hidden="true">D</span> Dispensador IoT</div>
      <div className="account"><span>{user.email}</span><button onClick={() => void onLogout()}>Cerrar sesión</button></div>
    </header>
    {!blocked && <nav aria-label="Secciones del dispensador">
      {views.map((item) => <button key={item} aria-current={view === item ? 'page' : undefined} onClick={() => setView(item)}>{item}</button>)}
    </nav>}
    <main className="content">
      <div className="title"><h1>{title}</h1>{!blocked && <span className={'connection ' + (status?.mqtt ? 'online' : '')}>{status ? status.mqtt ? 'MQTT conectado' : 'MQTT sin conexión' : 'Verificando conexión'}</span>}</div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {!blocked && view === 'Estado' && <>
        <div className="metrics">
          <Metric title="Controlador ESP32" value={status ? status.esp32.online ? data?.estado ?? 'Conectado' : 'Sin conexión' : '—'} detail={status?.esp32.seen ? 'Última señal · ' + dateLabel(status.esp32.seen) : undefined} />
          <Metric title="Nivel de la tolva" value={level} detail={data?.alerta_tolva !== 'NINGUNA' ? data?.alerta_tolva : undefined} />
          <Metric title="Raciones en 24 h" value={data?.dispensaciones_24h ?? '—'} detail={data?.ultimo_resultado ? 'Último resultado · ' + data.ultimo_resultado : undefined} />
          <Metric title="ESP32-CAM" value={status ? status.camera.online ? status.camera.data?.camara ? 'En línea' : 'Error de cámara' : 'Sin conexión' : '—'} detail={status?.camera.seen ? 'Última señal · ' + dateLabel(status.camera.seen) : undefined} />
        </div>
        <section className="surface">
          <h2>Telemetría del controlador</h2>
          <dl className="details">
            <div><dt>Modo</dt><dd>{typeof data?.modo === 'string' ? data.modo : '—'}</dd></div>
            <div><dt>Servo</dt><dd>{data?.servo ?? '—'}</dd></div>
            <div><dt>Señal Wi-Fi</dt><dd>{data?.rssi === undefined ? '—' : data.rssi + ' dBm'}</dd></div>
            <div><dt>Tiempo de espera</dt><dd>{data?.cooldown_s === undefined ? '—' : data.cooldown_s + ' s'}</dd></div>
            <div><dt>Dispensaciones totales</dt><dd>{data?.dispensaciones_total ?? '—'}</dd></div>
            <div><dt>Desde la última dosis</dt><dd>{duration(data?.ultima_dispensacion_hace_s)}</dd></div>
            <div><dt>Tiempo encendido</dt><dd>{duration(data?.uptime_s)}</dd></div>
            <div><dt>Error</dt><dd>{data ? data.error || 'Sin error' : '—'}</dd></div>
          </dl>
        </section>
      </>}
      {!blocked && view === 'Control' && <div className="stack">
        <section className="surface">
          <h2>Dispensación manual</h2>
          <form className="actions" onSubmit={(event) => void command('dispense', event)}>
            <label>Porciones<select value={Math.min(portions, limit)} onChange={(event) => setPortions(Number(event.target.value))}>
              {Array.from({ length: limit }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
            </select></label>
            <button className="primary" disabled={!canDispense}>{busy ? 'Enviando…' : 'Dispensar'}</button>
          </form>
          {!ready && !busy && <p>El broker y el ESP32 deben estar conectados para enviar un comando.</p>}
          {data?.dispensando && <p>El dispensador está ocupado.</p>}
          {Boolean(data?.cooldown_s) && <p>Tiempo de espera del ESP32 · {data?.cooldown_s} s.</p>}
        </section>
        <section className="surface"><h2>Errores del dispensador</h2>
          <p>Estado actual · {data ? data.error || 'Sin error' : 'Sin telemetría reciente'}</p>
          <button disabled={!ready} onClick={() => void command('reset-errors')}>Borrar errores</button>
        </section>
        {result && <p className={'notice ' + (result.warn ? 'error' : '')} role="status">{result.message}</p>}
      </div>}
      {!blocked && view === 'Cámara' && <Camera user={user} status={status} refresh={() => refresh()} />}
      {!blocked && view === 'Galería' && <Gallery user={user} />}
      {!blocked && view === 'Historial' && <History user={user} />}
    </main>
  </div>;
}
