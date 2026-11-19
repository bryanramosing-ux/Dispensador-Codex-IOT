import { frame } from '@/lib/server/camera';
import { jpeg, operator } from '@/lib/server/http';

export function GET(request: Request) {
  return operator(request, async () => jpeg(await frame()));
}
