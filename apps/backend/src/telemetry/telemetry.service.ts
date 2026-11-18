import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DevicesService } from '../devices/devices.service';
import { HistoryService } from '../history/history.service';
import { LocalStore } from '../persistence/local-store';
import { type JsonObject, utc } from '../config/http';
import type { AlertDto, TelemetryDto } from './telemetry.dto';

function fingerprint(data: JsonObject) {
  return createHash('sha256')
    .update(JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b))))
    .digest('hex');
}

@Injectable()
export class TelemetryService {
  private lastAlert?: { key: string; at: number };
  constructor(
    private readonly devices: DevicesService,
    private readonly history: HistoryService,
    private readonly store: LocalStore,
  ) {
    this.lastAlert = this.store.get('settings', 'last-alert');
  }

  receive(data: TelemetryDto, ip: string) {
    const previous = this.devices.esp32?.data;
    const seen = Date.now();
    const snapshot = { data: data as JsonObject, seen, ip };
    const key = fingerprint(snapshot.data);
    const sameSample = previous && fingerprint(previous) === key && this.devices.esp32?.ip === ip;
    this.history.atomic((tx, add) => {
      if (!sameSample)
        tx.set('telemetry', randomUUID(), seen, {
          deviceId: 'esp32',
          ts: utc(seen),
          ip,
          payload: snapshot.data,
        });
      tx.set('device_status', 'esp32', seen, { ...snapshot, online: true });
      if (!this.devices.espOnline) add('conexion', 'ESP32 conectado');
      if (previous?.estado !== data.estado)
        add('estado', 'ESP32: ' + (previous?.estado ?? '—') + ' → ' + data.estado);
      if (data.error && previous?.error !== data.error) add('error', 'ESP32 error: ' + data.error);
      if (
        previous &&
        data.dispensaciones_total !== undefined &&
        previous.dispensaciones_total !== data.dispensaciones_total
      ) {
        add(
          'dispensacion',
          'Dispensación #' +
            data.dispensaciones_total +
            ' (' +
            (data.ultimo_origen ?? '?') +
            ', ' +
            (data.ultimas_porciones ?? '?') +
            ' porc.) → ' +
            (data.ultimo_resultado ?? '?'),
          {
            contador: data.dispensaciones_total,
            origen: data.ultimo_origen ?? null,
            porciones: data.ultimas_porciones ?? null,
            resultado: data.ultimo_resultado ?? null,
          },
        );
      }
    }, seen);
    this.devices.esp32 = snapshot;
    this.devices.espOnline = true;
    this.devices.publish();
  }

  alert(input: AlertDto) {
    const at = Date.now();
    const key = fingerprint(input);
    if (this.lastAlert?.key === key && at - this.lastAlert.at < 35000) return;
    this.history.atomic((tx, add) => {
      tx.set('settings', 'last-alert', at, { key, at });
      add('alerta', 'Alerta ' + input.tipo + ' (nivel ' + (input.nivel ?? '?') + ' %)', input);
    }, at);
    this.lastAlert = { key, at };
  }
}
