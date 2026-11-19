import { captureInterval } from '@/lib/contracts';
import { changeInterval } from '@/lib/server/camera';
import { body, json, operator } from '@/lib/server/http';

export function PUT(request: Request) {
  return operator(request, async () => {
    const { interval_s } = await body(request, captureInterval);
    await changeInterval(interval_s);
    return json({ interval_s });
  });
}
