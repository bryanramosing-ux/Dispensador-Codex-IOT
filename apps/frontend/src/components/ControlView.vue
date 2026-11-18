<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api, commandKey, type Status } from '../api';
const props = defineProps<{
  status: Status | null;
  confirm: (title: string, body: string) => Promise<boolean>;
}>();
const d = computed(() => props.status?.esp32.data);
const portions = ref(1),
  busy = ref(false);
const message = ref(''),
  resultClass = ref('');
const canReset = computed(
  () => !!props.status?.remote_commands && !!props.status?.esp32.online && !busy.value,
);
const canDispense = computed(() => canReset.value && !!d.value && !d.value.dispensando);
watch(
  () => props.status?.max_portions,
  (max) => {
    if (max && portions.value > max) portions.value = max;
  },
);
const note = computed(() => {
  const s = props.status;
  if (!s) return 'Sin conexión con el servidor.';
  if (!s.remote_commands)
    return 'Control remoto deshabilitado. Configure el token del dispositivo en el backend y en secrets.h del ESP32.';
  if (!s.esp32.online) return 'El ESP32 está desconectado. Los comandos requieren conexión.';
  if (d.value?.dispensando) return 'Hay una dispensación en curso.';
  return 'El dispensador está listo. Cada dispensación pide confirmación.';
});
async function dispense() {
  const n = portions.value;
  if (
    !(await props.confirm(
      'Confirmar dispensación',
      'Se moverá el servo para entregar ' +
        n +
        (n === 1 ? ' porción' : ' porciones') +
        ' de alimento. ¿Continuar?',
    )) ||
    !canDispense.value
  )
    return;
  busy.value = true;
  message.value = 'Enviando comando…';
  resultClass.value = '';
  const result = await api(
    'POST',
    '/api/dispense',
    { porciones: n, confirm: true },
    { 'Idempotency-Key': commandKey() },
  );
  busy.value = false;
  resultClass.value = result.ok ? 'okc' : 'err';
  if (result.ok) message.value = 'Comando aceptado por el ESP32 (' + (result.data.resultado ?? 'OK') + ').';
  else if (result.status === 0 || result.status === 503)
    message.value = result.data.error ?? 'No se pudo confirmar el resultado.';
  else
    message.value =
      'Comando rechazado: ' + (result.data.error ?? result.data.resultado ?? 'HTTP ' + result.status);
}
async function reset() {
  if (
    !(await props.confirm(
      'Borrar errores',
      'Se pedirá al ESP32 borrar sus errores. Confirme que revisó el mecanismo.',
    )) ||
    !canReset.value
  )
    return;
  busy.value = true;
  const result = await api('POST', '/api/reset-errors', undefined, { 'Idempotency-Key': commandKey() });
  busy.value = false;
  resultClass.value = result.ok ? 'okc' : 'err';
  message.value = result.ok
    ? (result.data.resultado ?? 'OK')
    : (result.data.error ?? 'HTTP ' + result.status);
}
</script>

<template>
  <section id="view-control" class="view active">
    <h1>Control del dispensador</h1>
    <div class="card form">
      <p class="sub">{{ note }}</p>
      <label class="inline"
        >Porciones
        <select v-model="portions">
          <option v-for="n in status?.max_portions ?? 1" :key="n" :value="n">
            {{ n }} {{ n === 1 ? 'porción' : 'porciones' }}
          </option>
        </select></label
      >
      <div class="toolbar">
        <button class="btn primary" :disabled="!canDispense" @click="dispense">Dispensar…</button>
        <button class="btn" :disabled="!canReset" @click="reset">Borrar errores del ESP32</button>
      </div>
      <p class="msg" :class="resultClass" role="status">{{ message }}</p>
      <dl v-if="d" class="meta">
        <dt>Estado</dt>
        <dd>{{ d.estado }}</dd>
        <dt>Servo</dt>
        <dd>{{ d.servo }}</dd>
        <dt>Espera (cooldown)</dt>
        <dd>{{ d.cooldown_s ?? '—' }} s</dd>
        <dt>Último resultado</dt>
        <dd>{{ d.ultimo_resultado }}</dd>
        <dt>Dispensaciones</dt>
        <dd>{{ d.dispensaciones_total ?? '—' }} (24 h: {{ d.dispensaciones_24h ?? '—' }})</dd>
      </dl>
    </div>
  </section>
</template>
