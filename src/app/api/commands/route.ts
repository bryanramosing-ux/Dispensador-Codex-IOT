import { commandInput } from '@/lib/contracts';
import { executeCommand } from '@/lib/server/commands';
import { body, json, operator } from '@/lib/server/http';

export function POST(request: Request) {
  return operator(request, async (uid) => {
    const input = await body(request, commandInput);
    return json(await executeCommand(input, uid));
  });
}
