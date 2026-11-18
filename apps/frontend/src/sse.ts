import { api, type Status } from './api';

export function subscribe(callbacks: {
  status(value: Status): void;
  event(): void;
  connected(online: boolean): void;
}) {
  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let lastFrame = Date.now();
  let closed = false;
  let generation = 0;

  function reconnect() {
    if (closed || retry) return;
    source?.close();
    callbacks.connected(false);
    const current = ++generation;
    void api<Status>('GET', '/api/status').then((result) => {
      if (closed || current !== generation) return;
      if (result.ok && result.data.esp32) callbacks.status(result.data as Status);
    });
    if (closed) return;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, 3000);
  }

  function connect() {
    lastFrame = Date.now();
    ++generation;
    source = new EventSource('/api/events');
    source.onopen = () => {
      lastFrame = Date.now();
      callbacks.connected(true);
    };
    source.onerror = reconnect;
    source.addEventListener('status', (event) => {
      lastFrame = Date.now();
      try {
        callbacks.status(JSON.parse(event.data) as Status);
      } catch {
        reconnect();
      }
    });
    source.addEventListener('evento', () => {
      lastFrame = Date.now();
      callbacks.event();
    });
  }
  connect();
  const watchdog = setInterval(() => {
    if (Date.now() - lastFrame > 20000) reconnect();
  }, 5000);
  return () => {
    closed = true;
    source?.close();
    clearInterval(watchdog);
    clearTimeout(retry);
  };
}
