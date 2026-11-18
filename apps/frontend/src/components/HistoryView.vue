<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api, formatDate, type HistoryEntry } from '../api';
const props = defineProps<{ revision: number }>();
const type = ref(''),
  entries = ref<HistoryEntry[]>([]),
  cursor = ref<string | null>(null);
const busy = ref(false),
  error = ref('');
let request = 0;
async function load(append = false) {
  const current = ++request;
  const params = new URLSearchParams({ limit: '200' });
  if (type.value) params.set('tipo', type.value);
  if (append && cursor.value) params.set('cursor', cursor.value);
  busy.value = true;
  error.value = '';
  const result = await api<{ items: HistoryEntry[] }>('GET', '/api/history?' + params);
  if (current !== request) return;
  busy.value = false;
  if (result.ok && result.data.items) {
    entries.value = append ? entries.value.concat(result.data.items) : result.data.items;
    cursor.value = result.cursor;
  } else error.value = result.data.error ?? 'No se pudo cargar el historial.';
}
watch(type, () => void load());
watch(
  () => props.revision,
  () => void load(),
);
onMounted(() => void load());
</script>

<template>
  <section id="view-historial" class="view active">
    <h1>Historial</h1>
    <div class="toolbar">
      <label class="inline"
        >Tipo
        <select v-model="type">
          <option value="">Todos</option>
          <option value="foto">Fotografías</option>
          <option value="dispensacion">Dispensaciones</option>
          <option value="estado">Cambios de estado</option>
          <option value="error">Errores</option>
          <option value="conexion">Conexiones</option>
          <option value="alerta">Alertas</option>
        </select>
      </label>
      <button class="btn" :disabled="busy" @click="load()">Actualizar</button>
    </div>
    <p v-if="error" class="msg err" role="alert">{{ error }}</p>
    <ul class="list">
      <li v-if="!entries.length && !busy && !error">Sin eventos.</li>
      <li v-for="entry in entries" :key="entry.id" :class="entry.tipo">
        <span class="t">{{ formatDate(entry.ts) }}</span><span class="k">{{ entry.tipo }}</span
        ><span>{{ entry.mensaje }}</span>
      </li>
    </ul>
    <button v-if="cursor" class="btn" :disabled="busy" @click="load(true)">Cargar más</button>
  </section>
</template>
