import { json, operator } from '@/lib/server/http';
import { list } from '@/lib/server/store';

export function GET(request: Request) {
  return operator(request, async () => json(await list('history', new URL(request.url).searchParams, (doc) => ({
    id: doc.id, ts: doc.get('ts'), tipo: doc.get('tipo'), mensaje: doc.get('mensaje'),
  }))));
}
