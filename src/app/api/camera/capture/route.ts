import { capture } from '@/lib/server/camera';
import { json, operator } from '@/lib/server/http';

export function POST(request: Request) {
  return operator(request, async () => json(await capture('manual'), 201));
}
