import assert from 'node:assert/strict';
import test from 'node:test';
import { captureInterval, commandInput, deviceOnline, dispenserData, isRecent, topics } from '../src/lib/contracts';

const id = '2ad64a70-0afe-4fe6-9495-2d2d709c1e52';

test('dispensar exige confirmación, identificador y un número entero de porciones', () => {
  const valid = { id, operation: 'dispense', portions: 3, confirm: true };
  assert.equal(commandInput.safeParse(valid).success, true);
  for (const overrides of [{ confirm: false }, { portions: 4 }, { portions: 0 }, { portions: 1.5 }, { id: 'sin UUID' }]) {
    assert.equal(commandInput.safeParse({ ...valid, ...overrides }).success, false);
  }
});

test('vigencia de la telemetría y validación de datos del firmware', () => {
  assert.equal(dispenserData.safeParse({ dispositivo: 'ESP32', estado: 'ESPERANDO', raciones_manual: 1 }).success, true);
  assert.equal(dispenserData.safeParse({ dispositivo: 'ESP32', estado: 'ESPERANDO', nivel_tolva: 120 }).success, false);
  assert.equal(isRecent(120, 130_000), true);
  assert.equal(isRecent(120, 165_000), false);
  assert.equal(isRecent(120, 109_999), false);
  assert.equal(deviceOnline(100, 'esp32', 50_099), true);
  assert.equal(deviceOnline(100, 'esp32', 50_100), false);
});

test('intervalos y separación de instalaciones MQTT', () => {
  for (const seconds of [0, 10, 3600]) assert.equal(captureInterval.safeParse({ interval_s: seconds }).success, true);
  for (const seconds of [-1, 1, 9, 3601, 11.2]) assert.equal(captureInterval.safeParse({ interval_s: seconds }).success, false);
  assert.equal(topics('pruebas-1').cameraFrame, 'dispensador/pruebas-1/camera/frame/');
  assert.throws(() => topics('../#'));
});
