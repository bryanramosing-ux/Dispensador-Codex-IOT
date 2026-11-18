<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api, type Status } from '../api';
const props = defineProps<{ status: Status | null }>();
const data = computed(() => props.status?.camera.data);
const online = computed(() => !!props.status?.camera.online);
const streamFailed = ref(false),
  source = ref(''),
  flash = ref(''),
  busy = ref(false);
const preferStream = computed(() => !!data.value?.stream && !streamFailed.value);
let frameTimer: ReturnType<typeof setInterval> | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
let pendingFrame: AbortController | undefined;
let frameUrl = '';
function clearFrame() {
  clearInterval(frameTimer);
  pendingFrame?.abort();
  pendingFrame = undefined;
  if (frameUrl) URL.revokeObjectURL(frameUrl);
  frameUrl = '';
}
function notify(text: string) {
  clearTimeout(flashTimer);
  flash.value = text;
  if (text)
    flashTimer = setTimeout(() => {
      flash.value = '';
    }, 2500);
}
async function takeFrame() {
  if (pendingFrame) return;
  const current = new AbortController();
  pendingFrame = current;
  try {
    const response = await fetch('/api/camera/frame', { signal: current.signal });
    if (!response.ok) throw new Error('fotograma no disponible');
    const bytes = await response.blob();
    if (current.signal.aborted) return;
    if (frameUrl) URL.revokeObjectURL(frameUrl);
    frameUrl = URL.createObjectURL(bytes);
    source.value = frameUrl;
  } catch {
    if (!current.signal.aborted) notify('✕ Sin fotograma (¿dispensando?)');
  } finally {
    if (pendingFrame === current) pendingFrame = undefined;
  }
}
watch(
  [online, preferStream, busy],
  ([isOnline, mjpeg, capturing]) => {
    clearFrame();
    source.value = '';
    if (!isOnline || capturing) return;
    if (mjpeg) source.value = '/api/camera/stream?k=' + Date.now();
    else {
      takeFrame();
      frameTimer = setInterval(takeFrame, 3000);
    }
  },
  { immediate: true },
);
watch(online, (value) => {
  if (!value) streamFailed.value = false;
});
async function capture() {
  busy.value = true;
  const result = await api('POST', '/api/capture');
  busy.value = false;
  notify(result.ok ? '● Captura guardada' : '✕ ' + (result.data.error ?? 'falló'));
}
async function refresh() {
  const result = await api('POST', '/api/camera/refresh');
  if (result.ok) streamFailed.value = false;
  else notify(result.data.error ?? 'No se pudo consultar la cámara.');
}
async function auto(event: Event) {
  const input = event.target as HTMLSelectElement;
  const result = await api('POST', '/api/auto-capture', { interval_s: Number(input.value) });
  if (!result.ok) {
    input.value = String(props.status?.auto_capture_s ?? 0);
    notify(result.data.error ?? 'No se guardó el intervalo.');
  }
}
onUnmounted(() => {
  clearFrame();
  clearTimeout(flashTimer);
});
</script>

<template>
  <section id="view-camara" class="view active">
    <h1>Cámara en tiempo real</h1>
    <div class="camera-box">
      <img v-if="source" :src="source" alt="Video en vivo de la ESP32-CAM" @error="streamFailed = true" />
      <div v-else class="cam-off">
        {{
          !status
            ? 'Sin conexión con el servidor.'
            : !online
              ? 'Cámara desconectada. Revise alimentación y Wi-Fi y pulse «Actualizar conexión».'
              : busy
                ? 'Capturando…'
                : 'Esperando fotograma…'
        }}
      </div>
      <span v-if="flash" class="flash" role="status">{{ flash }}</span>
    </div>
    <div class="toolbar">
      <button class="btn" @click="refresh">Actualizar conexión</button>
      <button class="btn primary" :disabled="!online || busy" @click="capture">
        {{ busy ? 'Capturando…' : 'Capturar fotografía' }}
      </button>
      <label class="inline"
        >Captura automática
        <select :value="status?.auto_capture_s ?? 0" @change="auto">
          <option value="0">Desactivada</option>
          <option value="30">Cada 30 s</option>
          <option value="60">Cada 1 min</option>
          <option value="300">Cada 5 min</option>
          <option value="900">Cada 15 min</option>
          <option
            v-if="status?.auto_capture_s && ![30, 60, 300, 900].includes(status.auto_capture_s)"
            :value="status.auto_capture_s"
          >
            Cada {{ status.auto_capture_s }} s
          </option>
        </select>
      </label>
    </div>
    <dl class="meta">
      <dt>Estado</dt>
      <dd>{{ online ? 'Conectada' : 'Desconectada' }}</dd>
      <dt>Dirección</dt>
      <dd>{{ status?.camera.url || '—' }}</dd>
      <dt>Modo</dt>
      <dd>{{ data ? (preferStream ? 'Video MJPEG' : 'Solo fotos (un fotograma cada 3 s)') : '—' }}</dd>
      <dt>Resolución</dt>
      <dd>{{ data ? (data.camara_res ?? data.resolucion ?? 'n/d') : '—' }}</dd>
      <dt>Fotos / fallos</dt>
      <dd>{{ data ? (data.fotos_ok ?? '—') + ' / ' + (data.fotos_fallidas ?? '—') : '—' }}</dd>
    </dl>
    <p class="note">
      La ESP32-CAM atiende una petición a la vez. Durante una captura, el video se pausa un instante. Si el
      flujo de video falla, se muestra un fotograma cada 3 s.
    </p>
  </section>
</template>
