import { json, operator } from '@/lib/server/http';
import { broker } from '@/lib/server/mqtt';
import { dashboard } from '@/lib/server/store';

export function GET(request: Request) {
  return operator(request, async () => json({
    ...await dashboard(),
    mqtt: broker()?.ready ?? false,
  }));
}
