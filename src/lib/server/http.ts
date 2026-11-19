import 'server-only';
import { ZodType } from 'zod';
import { auth, db } from './firebase';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const noStore = { 'Cache-Control': 'no-store' };

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noStore });
}

export function jpeg(bytes: Buffer, filename?: string, attachment = false) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...noStore,
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      ...(filename && { 'Content-Disposition': (attachment ? 'attachment' : 'inline') + '; filename="' + filename + '"' }),
    },
  });
}

export async function operator(request: Request, action: (uid: string) => Promise<Response>) {
  try {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token || token.length > 8192) throw new HttpError(401, 'Inicia sesión para continuar.');
    let uid: string;
    try {
      uid = (await auth().verifyIdToken(token, true)).uid;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
        'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code)) {
        throw new HttpError(401, 'La sesión venció o es inválida.');
      }
      throw error;
    }
    const access = await db().collection('operators').doc(uid).get();
    if (access.get('active') !== true) throw new HttpError(403, 'Tu cuenta necesita permiso de operador.');
    return await action(uid);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Error de API', (error as { code?: unknown })?.code ?? (error as Error)?.name);
    return json({ error: 'El servidor no pudo completar la operación.' }, 503);
  }
}

export async function body<T>(request: Request, schema: ZodType<T>) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Falta el cuerpo JSON.');
  const decoder = new TextDecoder();
  let size = 0;
  let value = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 4096) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'El cuerpo excede el tamaño permitido.');
    }
    value += decoder.decode(chunk.value, { stream: true });
  }
  let input: unknown;
  try {
    input = JSON.parse(value + decoder.decode());
  } catch {
    throw new HttpError(400, 'El cuerpo debe contener JSON válido.');
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Los datos de la solicitud son inválidos.');
  return parsed.data;
}
