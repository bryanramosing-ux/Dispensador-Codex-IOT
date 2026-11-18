export const MAX_PHOTO = 5 * 1024 * 1024;

export async function edgeRequest(
  base: string,
  path: string,
  options: {
    timeout: number;
    limit: number;
    signal?: AbortSignal;
    form?: URLSearchParams;
  },
) {
  if (!base) throw new Error('destino desconocido');
  const timeout = AbortSignal.timeout(options.timeout);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(base + path, {
    method: options.form ? 'POST' : 'GET',
    body: options.form,
    redirect: 'manual',
    signal,
    headers: { 'User-Agent': 'dispensador-backend/3' },
  });
  const reader = response.body?.getReader();
  if (!reader) return { status: response.status, body: Buffer.alloc(0) };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > options.limit)
      throw new Error('respuesta demasiado grande');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > options.limit) throw new Error('respuesta demasiado grande');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { status: response.status, body: Buffer.concat(chunks, size) };
}
