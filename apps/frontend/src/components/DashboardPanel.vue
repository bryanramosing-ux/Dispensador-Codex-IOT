<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatDate, formatTime, photoUrl, type Status } from '../api';
const props = defineProps<{ status: Status | null }>();
defineEmits<{ photo: [name: string] }>();
const device = computed(() => props.status?.esp32.data);
const level = computed(() => device.value?.nivel_tolva ?? -1);
const levelOk = computed(() => !!device.value?.sensor_nivel_ok && level.value >= 0);
const gauge = computed(() => ({
  width: (levelOk.value ? Math.min(level.value, 100) : 0) + '%',
  background: !levelOk.value
    ? 'var(--muted)'
    : level.value < 20
      ? 'var(--bad)'
      : level.value < 35
        ? 'var(--warn)'
        : 'var(--ok)',
}));
const lastDose = computed(() => device.value?.ultima_dispensacion_hace_s ?? -1);
const alerts = computed(() => {
  const s = props.status,
    d = device.value;
  if (!s) return ['Sin conexión con el servidor local.'];
  const result: string[] = [];
  if (!s.esp32.online) result.push('ESP32 desconectado.');
  if (!s.camera.online) result.push('ESP32-CAM desconectada.');
  if (d?.error) result.push('Error del ESP32: ' + d.error);
  if (d?.alerta_tolva && d.alerta_tolva !== 'NINGUNA') result.push('Tolva: ' + d.alerta_tolva);
  if (d && !d.sensor_nivel_ok) result.push('El sensor de nivel no entrega lectura.');
  if (d && !d.wifi_conectado) result.push('El ESP32 perdió el Wi-Fi.');
  return result.length ? result : ['Sin alertas.'];
});
const spark = ref<HTMLCanvasElement>();
const samples: number[] = [];
let lastSample = 0;
watch(
  () => props.status,
  () => {
    const canvas = spark.value,
      distance = device.value?.distancia_nivel_cm,
      now = Date.now();
    if (!canvas || !device.value?.sensor_nivel_ok || distance === undefined || now - lastSample < 1500)
      return;
    lastSample = now;
    samples.push(distance);
    if (samples.length > 60) samples.shift();
    const ctx = canvas.getContext('2d');
    if (!ctx || samples.length < 2) return;
    const { width, height } = canvas,
      min = Math.min(...samples),
      max = Math.max(...samples, min + 1);
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((value, index) => {
      const x = (index * (width - 4)) / (samples.length - 1) + 2;
      const y = height - 4 - ((value - min) / (max - min)) * (height - 8);
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  },
);
</script>

<template>
  <section id="view-panel" class="view active">
    <h1>Panel general</h1>
    <div class="cards">
      <article class="card">
        <h2>Dispensador</h2>
        <p class="big">
          {{
            device
              ? device.error
                ? 'Atención'
                : device.dispensando
                  ? 'Dispensando'
                  : 'Operativo'
              : status
                ? 'ESP32 desconectado'
                : 'Sin datos'
          }}
        </p>
        <p class="sub">
          {{
            device
              ? device.error || 'Estado: ' + (device.estado ?? '—')
              : 'Esperando datos actuales del ESP32'
          }}
        </p>
      </article>
      <article class="card">
        <h2>ESP32</h2>
        <p class="big">
          <span class="dot" :class="status?.esp32.online ? 'on' : 'off'"></span
          >{{ status?.esp32.online ? 'Conectado' : 'Desconectado' }}
        </p>
        <p class="sub">
          {{
            !status
              ? 'Sin datos del servidor'
              : status.esp32.online
                ? status.esp32.ip
                : status.esp32.age_s != null
                  ? 'Último dato hace ' + formatTime(status.esp32.age_s)
                  : 'Nunca se ha conectado'
          }}
        </p>
      </article>
      <article class="card">
        <h2>ESP32-CAM</h2>
        <p class="big">
          <span class="dot" :class="status?.camera.online ? 'on' : 'off'"></span
          >{{ status?.camera.online ? 'Conectada' : 'Desconectada' }}
        </p>
        <p class="sub">{{ status?.camera.url }}</p>
      </article>
      <article class="card">
        <h2>Wi-Fi</h2>
        <p class="big">{{ device ? (device.wifi_conectado ? 'Conectado' : 'Sin Wi-Fi') : '—' }}</p>
        <p class="sub" v-if="device?.rssi">
          {{ device.rssi }} dBm{{ device.backend ? ' · servidor enlazado' : '' }}
        </p>
      </article>
      <article class="card">
        <h2>Nivel de alimento</h2>
        <div class="gauge"><div class="gauge-fill" :style="gauge"></div></div>
        <p class="big">{{ device ? (levelOk ? Math.round(level) + ' %' : 'Sin lectura') : '—' }}</p>
        <p v-if="device" class="sub">
          {{
            device.alerta_tolva && device.alerta_tolva !== 'NINGUNA'
              ? 'Alerta: ' + device.alerta_tolva
              : levelOk
                ? 'Nivel estimado'
                : 'Revise el sensor de la tolva'
          }}
        </p>
      </article>
      <article class="card">
        <h2>Distancia (sensor de tolva)</h2>
        <p class="big">
          {{
            device?.sensor_nivel_ok && device.distancia_nivel_cm != null
              ? device.distancia_nivel_cm.toFixed(1) + ' cm'
              : '—'
          }}
        </p>
        <canvas ref="spark" width="300" height="60" aria-label="Historial de distancia"></canvas>
      </article>
      <article class="card">
        <h2>Servomotor</h2>
        <p class="big">
          {{
            device
              ? device.servo === 'DISPENSANDO'
                ? 'Dispensando'
                : device.servo === 'ERROR'
                  ? 'Error'
                  : 'En reposo'
              : '—'
          }}
        </p>
        <p v-if="device?.pulso_servo_us != null" class="sub">Pulso {{ device.pulso_servo_us }} µs</p>
      </article>
      <article class="card">
        <h2>Última dispensación</h2>
        <p class="big">{{ lastDose >= 0 ? 'hace ' + formatTime(lastDose) : device ? 'Ninguna' : '—' }}</p>
        <p v-if="lastDose >= 0" class="sub">
          {{ device?.ultimas_porciones }} porc. · {{ device?.ultimo_origen }} ·
          {{ device?.dispensaciones_total }} en total
        </p>
      </article>
      <article class="card">
        <h2>Tiempo de actividad</h2>
        <p class="big">{{ formatTime(device?.uptime_s) }}</p>
        <p v-if="status" class="sub">
          {{ device ? 'ESP32 · ' : '' }}servidor {{ formatTime(status.backend_uptime_s) }}
        </p>
      </article>
      <article class="card wide">
        <h2>Última fotografía</h2>
        <div v-if="status?.last_photo" class="sub">
          <button
            class="photo-preview"
            aria-label="Abrir última captura"
            @click="$emit('photo', status.last_photo.name)"
          >
            <img :src="photoUrl(status.last_photo.name)" alt="Última captura" />
          </button>
          <div class="sub">{{ formatDate(status.last_photo.ts) }}</div>
        </div>
        <div v-else class="sub">Sin fotografías todavía.</div>
      </article>
      <article class="card wide">
        <h2>Alertas del sistema</h2>
        <ul class="list">
          <li v-for="item in alerts" :key="item">{{ item }}</li>
        </ul>
      </article>
    </div>
  </section>
</template>
