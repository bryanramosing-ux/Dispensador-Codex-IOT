<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, formatDate, photoUrl, type Photo } from '../api';
const props = defineProps<{ confirm: (title: string, body: string) => Promise<boolean> }>();
defineEmits<{ photo: [name: string] }>();
const photos = ref<Photo[]>([]),
  order = ref('desc'),
  busy = ref(false),
  error = ref('');
const cursor = ref<string | null>(null);
const sorted = computed(() => (order.value === 'asc' ? photos.value.slice().reverse() : photos.value));
async function load(append = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  const result = await api<{ items: Photo[] }>(
    'GET',
    '/api/gallery' + (append && cursor.value ? '?cursor=' + encodeURIComponent(cursor.value) : ''),
  );
  busy.value = false;
  if (result.ok && result.data.items) {
    photos.value = append ? photos.value.concat(result.data.items) : result.data.items;
    cursor.value = result.cursor;
  } else error.value = result.data.error ?? 'No se pudo cargar la galería.';
}
async function remove(photo: Photo) {
  if (
    !(await props.confirm(
      'Eliminar fotografía',
      'Se borrará ' + photo.name + ' de forma permanente. ¿Continuar?',
    ))
  )
    return;
  const result = await api('DELETE', photoUrl(photo.name), undefined, { 'X-Confirm': 'delete' });
  if (result.ok) {
    photos.value = photos.value.filter((item) => item.name !== photo.name);
    await load();
  } else error.value = result.data.error ?? 'No se pudo eliminar.';
}
onMounted(() => void load());
</script>

<template>
  <section id="view-galeria" class="view active">
    <h1>Galería</h1>
    <div class="toolbar">
      <button class="btn" :disabled="busy" @click="load()">Actualizar</button>
      <label class="inline"
        >Orden
        <select v-model="order">
          <option value="desc">Más recientes primero</option>
          <option value="asc">Más antiguas primero</option>
        </select></label
      >
      <span class="sub">{{ photos.length }} fotos</span>
    </div>
    <p v-if="error" class="msg err" role="alert">{{ error }}</p>
    <div class="grid">
      <div v-for="photo in sorted" :key="photo.name" class="thumb">
        <button class="photo-preview" :aria-label="'Abrir ' + photo.name" @click="$emit('photo', photo.name)">
          <img loading="lazy" :alt="photo.name" :src="photoUrl(photo.name)" />
        </button>
        <div class="info">
          <span>{{ formatDate(photo.ts) }} · {{ Math.round(photo.size / 1024) }} kB</span>
          <div class="acts">
            <a class="btn" :href="photoUrl(photo.name, true)">Descargar</a
            ><button class="btn" @click="remove(photo)">Eliminar</button>
          </div>
        </div>
      </div>
    </div>
    <p v-if="!photos.length && !busy && !error" class="sub">
      No hay fotografías. Capture una desde la pestaña Cámara.
    </p>
    <button v-if="cursor" class="btn" :disabled="busy" @click="load(true)">Cargar más</button>
  </section>
</template>
