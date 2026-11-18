import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import { fail } from '../config/http';

@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly clients = new Map<Response, () => boolean>();
  private readonly keepalive = setInterval(() => this.broadcast(': keepalive\n\n'), 15000);

  subscribe(res: Response, initial: unknown, authorize: () => boolean) {
    if (this.clients.size >= 32) fail(429, 'capacidad de SSE agotada');
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
    res.on('close', () => this.clients.delete(res));
    res.flushHeaders();
    this.clients.set(res, authorize);
    this.write(res, this.format('status', initial));
  }

  publish(event: 'status' | 'evento', data: unknown) {
    this.broadcast(this.format(event, data));
  }

  private format(name: string, data: unknown) {
    return 'event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n';
  }
  private broadcast(frame: string) {
    for (const [client, authorized] of this.clients) {
      if (authorized()) this.write(client, frame);
      else {
        this.clients.delete(client);
        client.end();
      }
    }
  }
  private write(client: Response, frame: string) {
    if (client.destroyed || client.writableEnded || client.writableNeedDrain || !client.write(frame)) {
      this.clients.delete(client);
      client.destroy();
    }
  }

  onModuleDestroy() {
    clearInterval(this.keepalive);
    for (const client of this.clients.keys()) client.end();
    this.clients.clear();
  }
}
