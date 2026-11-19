import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { COMMAND_GAP_MS, COMMAND_TTL_SECONDS, deviceOnline, type CommandInput, type CommandResult } from '@/lib/contracts';
import { db } from './firebase';
import { HttpError } from './http';
import { broker } from './mqtt';
import { addHistory } from './store';

export async function executeCommand(input: CommandInput, uid: string): Promise<CommandResult> {
  const database = db();
  const ref = database.collection('commands').doc(input.id);
  const lock = database.collection('settings').doc('command_dispatch');
  const device = database.collection('device_status').doc('esp32');
  const portions = input.operation === 'dispense' ? input.portions : null;
  const reserved = await database.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const at = Date.now();
    if (existing.exists) {
      if (existing.get('requestedBy') !== uid || existing.get('operation') !== input.operation || existing.get('portions') !== portions) {
        throw new HttpError(409, 'El identificador ya está asociado a otra solicitud.');
      }
      const state = existing.get('state') as CommandResult['state'];
      if (state === 'pending' && existing.get('lockUntil') <= at) {
        tx.update(ref, { state: 'outcome_unknown', finishedAt: Timestamp.fromMillis(at) });
        addHistory(tx, 'error', 'Resultado del comando desconocido', at, { commandId: input.id });
        return { previous: { id: input.id, state: 'outcome_unknown' } satisfies CommandResult };
      }
      const result = existing.get('result') as string | undefined;
      return { previous: { id: input.id, state, ...(result && { result }) } };
    }

    if (!broker()?.ready) throw new HttpError(503, 'El broker MQTT no está disponible.');
    const [gate, status] = await tx.getAll(lock, device);
    if (!deviceOnline(status.get('seen'), 'esp32', at)) throw new HttpError(503, 'El ESP32 está desconectado.');
    if ((gate.get('busyUntil') ?? 0) > at) throw new HttpError(409, 'Hay otro comando pendiente.');
    if (input.operation === 'dispense') {
      if (status.get('data.dispensando') === true) throw new HttpError(409, 'El dispensador está ocupado.');
      if (input.portions > (status.get('data.max_porciones') ?? Number.POSITIVE_INFINITY)) {
        throw new HttpError(400, 'Las porciones superan el límite de la placa.');
      }
      if ((gate.get('nextDispenseAt') ?? 0) > at) throw new HttpError(429, 'Espera unos segundos entre solicitudes.');
    }
    const expiresAt = Math.floor(at / 1000) + COMMAND_TTL_SECONDS;
    const lockUntil = expiresAt * 1000 + 2500;
    tx.create(ref, {
      operation: input.operation, portions, requestedBy: uid, state: 'pending',
      recordedAt: Timestamp.fromMillis(at), expiresAt, lockUntil,
    });
    tx.set(lock, {
      commandId: input.id, busyUntil: lockUntil,
      ...(input.operation === 'dispense' && { nextDispenseAt: at + COMMAND_GAP_MS }),
    }, { merge: true });
    return { expiresAt };
  });

  if (reserved.previous) return reserved.previous;
  const ack = await broker()?.command({ id: input.id, expiresAt: reserved.expiresAt, operation: input.operation, portions });
  const state = ack ? (ack.ok ? 'accepted' : 'rejected') : 'outcome_unknown';
  const at = Date.now();
  return database.runTransaction(async (tx): Promise<CommandResult> => {
    const [command, gate] = await tx.getAll(ref, lock);
    if (command.get('state') !== 'pending') {
      const result = command.get('result') as string | undefined;
      return { id: input.id, state: command.get('state'), ...(result && { result }) };
    }
    tx.update(ref, { state, finishedAt: Timestamp.fromMillis(at), ...(ack && { result: ack.resultado }) });
    if (gate.get('commandId') === input.id) tx.update(lock, { busyUntil: 0 });
    const result = ack?.resultado ?? 'Resultado desconocido';
    const message = input.operation === 'dispense' ? 'Solicitud de ' + portions + ' porc. · ' + result : 'Reinicio de errores · ' + result;
    addHistory(tx, !ack ? 'error' : 'comando', message, at, { commandId: input.id, state });
    return { id: input.id, state, ...(ack && { result: ack.resultado }) };
  });
}
