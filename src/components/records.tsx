'use client';

import type { User } from 'firebase/auth';
import Image from 'next/image';
import { useEffect, useState, type FormEvent } from 'react';
import type { Dashboard, HistoryEntry, Page, Photo } from '@/lib/contracts';
import { api, dateLabel, request } from '@/lib/firebase-client';

function Picture({ src, alt }: { src: string; alt: string }) {
  return <Image className="picture" unoptimized src={src} alt={alt} width={800} height={600} />;
}

export function Camera({ user, status, refresh }: { user: User; status?: Dashboard; refresh: () => Promise<void> }) {
  const [preview, setPreview] = useState(false);
  const [image, setImage] = useState('');
  const [frameError, setFrameError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const ready = Boolean(status?.mqtt && status.camera.online && status.camera.data?.camara);

  useEffect(() => {
    if (!preview || !ready) return;
    const controller = new AbortController();
    let url: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (!document.hidden) {
          const response = await request(user, 'camera/frame', { signal: controller.signal });
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          if (url) URL.revokeObjectURL(url);
          url = URL.createObjectURL(blob);
          setImage(url);
          setFrameError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setFrameError((error as Error).message);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [preview, ready, user]);

  async function update(path: string, options: RequestInit, success: string) {
    setSaving(true);
    setMessage('');
    try {
      await api(user, path, options);
      setMessage(success);
      await refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = Number(new FormData(event.currentTarget).get('interval'));
    void update('camera/settings', { method: 'PUT', body: JSON.stringify({ interval_s: raw }) },
      raw === 0 ? 'Captura automática desactivada.' : 'Intervalo guardado.');
  }

  return <div className="stack">
    <section className="surface">
      <h2>Vista remota</h2>
      {ready && status?.camera.data?.resolucion && <p>Resolución · {status.camera.data.resolucion}</p>}
      {preview && ready && image ? <Picture src={image} alt="Última imagen de la ESP32-CAM" />
        : <div className="picture empty">{!ready ? 'Cámara sin conexión' : preview ? 'Esperando imagen…' : 'Vista previa detenida'}</div>}
      {preview && ready && frameError && <p className="notice error" role="alert">{frameError}</p>}
      <div className="actions">
        <button disabled={!ready && !preview} onClick={() => { setImage(''); setFrameError(''); setPreview(!preview); }}>{preview ? 'Detener vista previa' : 'Abrir vista previa'}</button>
        <button className="primary" disabled={!ready || saving || !status?.photosEnabled}
          onClick={() => void update('camera/capture', { method: 'POST' }, 'Foto guardada en la galería.')}>Guardar foto</button>
      </div>
    </section>
    <section className="surface">
      <h2>Captura automática</h2>
      <p>{status?.photosEnabled ? 'Usa 0 para desactivarla. Intervalo de 10 a 3600 segundos.' : 'Configura Cloud Storage para guardar fotos.'}</p>
      <form className="actions" onSubmit={configure} key={status?.autoCapture}>
        <label>Intervalo en segundos<input name="interval" type="number" min={0} max={3600} defaultValue={status?.autoCapture ?? 0} required /></label>
        <button disabled={saving || !status?.photosEnabled}>Guardar intervalo</button>
      </form>
    </section>
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
}

const categories = {
  conexion: 'Conexión', estado: 'Estado', error: 'Error', dispensacion: 'Dispensación',
  alerta: 'Alerta', comando: 'Comando', captura: 'Captura',
};

export function History({ user }: { user: User }) {
  const [type, setType] = useState('');
  const [page, setPage] = useState<Page<HistoryEntry>>();
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (type) params.set('tipo', type);
    if (cursor) params.set('cursor', cursor);
    api<Page<HistoryEntry>>(user, 'history?' + params, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setPage(value);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [user, type, cursor, revision]);

  function load(next: string, filter: string) {
    setPage(undefined);
    setError('');
    setCursor(next);
    setType(filter);
    setRevision((value) => value + 1);
  }

  return <section className="surface">
    <div className="actions">
      <label>Tipo de evento<select value={type} onChange={(event) => load('', event.target.value)}>
        <option value="">Todos</option>
        {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <button onClick={() => load('', type)}>Actualizar</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!page && !error && <p role="status">Cargando el historial…</p>}
    {page && (page.items.length ? <div className="table-wrap">
      <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Evento</th></tr></thead>
        <tbody>{page.items.map((item) => <tr key={item.id}>
          <td>{dateLabel(item.ts)}</td><td>{categories[item.tipo as keyof typeof categories] ?? item.tipo}</td><td>{item.mensaje}</td>
        </tr>)}</tbody>
      </table></div> : <p>Aún no hay eventos para este filtro.</p>)}
    {page?.next && <button onClick={() => load(page.next!, type)}>Ver eventos anteriores</button>}
    {cursor && <button onClick={() => load('', type)}>Volver a los más recientes</button>}
  </section>;
}

export function Gallery({ user }: { user: User }) {
  const [page, setPage] = useState<Page<Photo>>();
  const [cursor, setCursor] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Photo>();
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    api<Page<Photo>>(user, 'gallery?' + params, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setPage(value);
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [user, cursor, revision]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let url: string | undefined;
    request(user, 'gallery/' + encodeURIComponent(selected.name), { signal: controller.signal })
      .then((response) => response.blob()).then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [user, selected]);

  function select(photo?: Photo) {
    setError('');
    setImage('');
    setSelected(photo);
  }

  function load(next: string) {
    setPage(undefined);
    select();
    setCursor(next);
    setRevision((value) => value + 1);
  }

  async function remove() {
    if (!selected || !window.confirm('¿Eliminar esta foto de la galería?')) return;
    setDeleting(true);
    try {
      await api(user, 'gallery/' + encodeURIComponent(selected.name), { method: 'DELETE', headers: { 'X-Confirm': 'delete' } });
      load('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return <section className="surface">
    <div className="actions"><button onClick={() => load('')}>Actualizar</button></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!page && !error && <p role="status">Cargando la galería…</p>}
    {page && (page.items.length ? <ul className="photos">{page.items.map((photo) =>
      <li key={photo.name}><button aria-pressed={photo.name === selected?.name} onClick={() => select(photo)}>
        {dateLabel(photo.ts)} <small>{Math.round(photo.size / 1024)} KB</small>
      </button></li>)}</ul> : <p>Aún no hay fotos guardadas.</p>)}
    {selected && <>
      {image ? <Picture src={image} alt={'Captura del ' + dateLabel(selected.ts)} /> : !error && <p role="status">Cargando imagen…</p>}
      <div className="actions">
        {image && <a className="button" href={image} download={selected.name}>Descargar</a>}
        <button disabled={deleting} onClick={() => void remove()}>Eliminar</button>
      </div>
    </>}
    {page?.next && <button onClick={() => load(page.next!)}>Ver fotos anteriores</button>}
    {cursor && <button onClick={() => load('')}>Volver a las más recientes</button>}
  </section>;
}
