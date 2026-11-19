import { json, operator } from '@/lib/server/http';
import { list } from '@/lib/server/store';

export function GET(request: Request) {
  return operator(request, async () => json(await list('photos', new URL(request.url).searchParams, (doc) => ({
    name: doc.id,
    ts: doc.get('ts'),
    size: doc.get('size'),
  }))));
}
