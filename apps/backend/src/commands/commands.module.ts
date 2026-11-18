import {
  Body,
  Controller,
  HttpCode,
  Injectable,
  Module,
  OnModuleInit,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Config } from '../config/config';
import { DtoPipe, fail, edgeObject, type JsonObject, utc } from '../config/http';
import { DevicesModule } from '../devices/devices.module';
import { DevicesService } from '../devices/devices.service';
import { edgeRequest } from '../devices/edge-http';
import { HistoryService } from '../history/history.service';
import { LocalStore } from '../persistence/local-store';
import { AdminGuard } from '../security/security';

type Operation = 'dispense' | 'reset-errors';
type Command = {
  operation: Operation;
  portions: number | null;
  confirmed: boolean;
  requestedAt: string;
  state: 'dispatching' | 'accepted' | 'rejected' | 'outcome_unknown';
  status?: number;
  response?: JsonObject;
  finishedAt?: string;
};
const reply = (status: number, error: string): { status: number; response: JsonObject } => ({
  status,
  response: { ok: false, error },
});

@Injectable()
export class CommandsService implements OnModuleInit {
  private busy = false;
  private lastDispatch = -Infinity;

  constructor(
    private readonly config: Config,
    private readonly devices: DevicesService,
    private readonly store: LocalStore,
    private readonly history: HistoryService,
  ) {}

  onModuleInit() {
    for (const { id, command } of this.store.interruptedCommands<Command>()) {
      this.history.atomic((tx, add) => {
        tx.set('commands', id, Date.parse(command.requestedAt), {
          ...command,
          ...reply(503, 'resultado del comando desconocido tras reinicio'),
          state: 'outcome_unknown',
          finishedAt: utc(),
        });
        add('error', 'Resultado de comando desconocido tras reiniciar el backend', { commandId: id });
      });
    }
  }

  async execute(operation: Operation, portions: number | null, idempotency?: string) {
    if (idempotency !== undefined && !/^[a-zA-Z0-9_-]{8,64}$/.test(idempotency))
      fail(400, 'Idempotency-Key inválida');
    const id = idempotency ? 'request-' + idempotency : randomUUID();
    const existing = this.store.get<Command>('commands', id);
    if (existing) {
      if (existing.operation !== operation || existing.portions !== portions)
        return reply(409, 'Idempotency-Key ya utilizada');
      if (existing.status === undefined || !existing.response) return reply(409, 'comando en curso');
      return { status: existing.status, response: existing.response };
    }

    const token = this.config.env.TOKEN_DISPOSITIVO;
    const isDispense = operation === 'dispense';
    if (!token)
      return reply(
        403,
        isDispense
          ? 'control remoto deshabilitado: defina TOKEN_DISPOSITIVO en backend/.env y secrets.h'
          : 'control remoto deshabilitado',
      );
    if (isDispense && (portions === null || portions < 1 || portions > this.config.env.MAX_PORCIONES)) {
      return reply(400, 'porciones debe ser un entero entre 1 y ' + this.config.env.MAX_PORCIONES);
    }
    if (isDispense && !this.devices.espOnline)
      return reply(503, 'ESP32 desconectado: no se envía el comando');
    if (this.busy) return reply(409, 'ya hay una dispensación en curso');
    const gap = this.config.env.MIN_DISPENSE_GAP_S;
    const elapsed = Math.min(
      (performance.now() - this.lastDispatch) / 1000,
      (Date.now() - (this.store.get<{ ms: number }>('settings', 'last-dispense')?.ms ?? 0)) / 1000,
    );
    if (isDispense && elapsed < gap)
      return reply(429, 'espere ' + Math.round(gap - elapsed) + ' s entre comandos');
    if (isDispense && this.devices.esp32?.data.dispensando) return reply(409, 'el dispensador está ocupado');
    const base = this.devices.deviceBase;
    if (!base) return reply(503, 'IP del ESP32 desconocida: aún no ha enviado telemetría');

    const now = Date.now();
    const command: Command = {
      operation,
      portions,
      confirmed: isDispense,
      requestedAt: new Date(now).toISOString(),
      state: 'dispatching',
    };
    this.busy = true;
    try {
      this.store.atomic((tx) => {
        tx.set('commands', id, now, command);
        if (isDispense) tx.set('settings', 'last-dispense', now, { ms: now });
      });
      if (isDispense) this.lastDispatch = performance.now();
      const result = await this.dispatch(base, operation, token, portions);
      this.history.atomic((tx, add) => {
        tx.set('commands', id, now, { ...command, ...result, finishedAt: utc() });
        const message = isDispense
          ? 'Comando desde dashboard: ' +
            portions +
            ' porc. → HTTP ' +
            result.status +
            ' ' +
            (result.response.resultado ?? result.response.error ?? '')
          : 'Borrar errores desde dashboard → HTTP ' + result.status;
        add(isDispense ? 'dispensacion' : 'estado', message, { commandId: id, estado: result.state });
      });
      return result;
    } finally {
      this.busy = false;
    }
  }

  private async dispatch(base: string, operation: Operation, token: string, portions: number | null) {
    try {
      const form = new URLSearchParams({ token });
      if (portions !== null) form.set('porciones', String(portions));
      const incoming = await edgeRequest(base, operation === 'dispense' ? '/dispensar' : '/reset-errores', {
        timeout: 5000,
        limit: 8192,
        form,
      });
      if (incoming.status >= 300 && incoming.status < 400) throw new Error('redirección rechazada');
      let response: JsonObject;
      try {
        const body: unknown = JSON.parse(incoming.body.toString() || '{}');
        if (
          !edgeObject(body) ||
          (incoming.status < 300 && (body.ok !== true || typeof body.resultado !== 'string'))
        ) {
          throw new Error('respuesta no válida');
        }
        response = body;
      } catch {
        if (incoming.status < 400) throw new Error('confirmación no válida');
        response = { ok: false, error: 'HTTP ' + incoming.status };
      }
      return { status: incoming.status, response, state: incoming.status < 300 ? 'accepted' : 'rejected' };
    } catch {
      return {
        ...reply(503, 'ESP32 no responde: resultado del comando desconocido'),
        state: 'outcome_unknown',
      };
    }
  }
}

const dispense = new DtoPipe(
  z.object({ confirm: z.literal(true), porciones: z.number().int() }),
  (body) =>
    body.confirm !== true ? 'falta confirmación explícita (confirm: true)' : 'porciones debe ser un entero',
  'porciones',
);

@Controller('api')
@UseGuards(AdminGuard)
class CommandsController {
  constructor(private readonly commands: CommandsService) {}

  @Post('dispense')
  @HttpCode(200)
  async dispense(
    @Body(dispense) body: { porciones: number; confirm: true },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.commands.execute('dispense', body.porciones, req.get('Idempotency-Key'));
    res.status(result.status);
    return result.response;
  }

  @Post('reset-errors')
  @HttpCode(200)
  async reset(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.commands.execute('reset-errors', null, req.get('Idempotency-Key'));
    res.status(result.status);
    return result.response;
  }
}

@Module({ imports: [DevicesModule], controllers: [CommandsController], providers: [CommandsService] })
export class CommandsModule {}
