import { json, operator } from '@/lib/server/http';

export function GET(request: Request) {
  return operator(request, async (uid) => json({ uid }));
}
