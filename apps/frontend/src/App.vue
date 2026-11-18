<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, photoUrl, sessionExpired, type Status } from './api';
import { subscribe } from './sse';
import DashboardPanel from './components/DashboardPanel.vue';
import CameraView from './components/CameraView.vue';
import GalleryView from './components/GalleryView.vue';
import ControlView from './components/ControlView.vue';
import HistoryView from './components/HistoryView.vue';

const tabs = {
  panel: 'Panel',
  camara: 'Cámara',
  galeria: 'Galería',
  control: 'Control',
  historial: 'Historial',
};
const view = ref<keyof typeof tabs>('panel');
const authenticated = ref(false),
  checking = ref(true),
  connected = ref(false),
  busy = ref(false);
const password = ref(''),
  error = ref('');
const status = ref<Status | null>(null);
const revision = ref(0);
const photo = ref(''),
  photoDialog = ref<HTMLDialogElement>();
const confirmDialog = ref<HTMLDialogElement>();
const message = ref({ title: '', body: '' });
let stop: (() => void) | undefined;
let answer: ((value: boolean) => void) | undefined;

const connectionText = computed(() =>
  connected.value ? 'Dashboard en vivo' : 'Sin conexión con el servidor',
);
function start() {
  authenticated.value = true;
  stop?.();
  stop = subscribe({
    status: (value) => {
      status.value = value;
    },
    event: () => {
      revision.value++;
    },
    connected: (value) => {
      connected.value = value;
      if (!value) status.value = null;
    },
  });
}
function expire() {
  stop?.();
  status.value = null;
  authenticated.value = false;
  connected.value = false;
  photoDialog.value?.close();
  confirmDialog.value?.close();
}
async function login() {
  busy.value = true;
  error.value = '';
  const result = await api('POST', '/api/session', { password: password.value });
  busy.value = false;
  if (result.ok) {
    password.value = '';
    start();
  } else error.value = result.data.error ?? 'No se pudo iniciar sesión.';
}
async function logout() {
  const result = await api('POST', '/api/session/logout');
  if (result.ok || result.status === 401) expire();
}
function openPhoto(name: string) {
  photo.value = name;
  photoDialog.value?.showModal();
}
function confirm(title: string, body: string): Promise<boolean> {
  if (!confirmDialog.value || confirmDialog.value.open) return Promise.resolve(false);
  message.value = { title, body };
  confirmDialog.value.returnValue = 'no';
  confirmDialog.value.showModal();
  return new Promise((resolve) => {
    answer = resolve;
  });
}
function closeConfirmation() {
  answer?.(confirmDialog.value?.returnValue === 'yes');
  answer = undefined;
}
onMounted(async () => {
  sessionExpired.addEventListener('expire', expire);
  const result = await api<{ authenticated: boolean }>('GET', '/api/session');
  checking.value = false;
  if (result.data.authenticated) start();
  else if (!result.ok) error.value = result.data.error ?? '';
});
onUnmounted(() => {
  stop?.();
  sessionExpired.removeEventListener('expire', expire);
});
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="logo">◈</span><span>Dispensador IoT</span></div>
      <nav v-if="authenticated" id="nav" aria-label="Vistas">
        <button
          v-for="(label, key) in tabs"
          :key="key"
          class="nav"
          :class="{ active: view === key }"
          :aria-current="view === key ? 'page' : undefined"
          @click="view = key"
        >
          {{ label }}
        </button>
      </nav>
      <div v-if="authenticated" id="link-state" class="link">
        <span class="dot" :class="connected ? 'on' : 'off'"></span><span>{{ connectionText }}</span>
      </div>
      <button v-if="authenticated" class="btn" @click="logout">Cerrar sesión</button>
    </aside>
    <main class="content">
      <p v-if="checking" class="sub">Conectando…</p>
      <form v-else-if="!authenticated" class="card form" @submit.prevent="login">
        <h1>Acceso al dispensador</h1>
        <label class="inline"
          >Contraseña <input v-model="password" type="password" autocomplete="current-password" required
        /></label>
        <div class="toolbar"><button class="btn primary" :disabled="busy">Iniciar sesión</button></div>
        <p v-if="error" class="msg err" role="alert">{{ error }}</p>
      </form>
      <template v-else>
        <div v-if="!connected" id="banner" class="banner" role="status">
          Sin flujo en tiempo real. El panel volverá a conectarse automáticamente.
        </div>
        <DashboardPanel v-show="view === 'panel'" :status="status" @photo="openPhoto" />
        <CameraView v-if="view === 'camara'" :status="status" />
        <GalleryView v-if="view === 'galeria'" :confirm="confirm" @photo="openPhoto" />
        <ControlView v-if="view === 'control'" :status="status" :confirm="confirm" />
        <HistoryView v-if="view === 'historial'" :revision="revision" />
      </template>
    </main>
  </div>
  <dialog id="dlg-photo" ref="photoDialog">
    <img v-if="photo" id="dlg-img" :src="photoUrl(photo)" alt="Fotografía capturada" />
    <div class="toolbar">
      <a class="btn" :href="photoUrl(photo, true)">Descargar</a
      ><button class="btn" @click="photoDialog?.close()">Cerrar</button>
    </div>
  </dialog>
  <dialog id="dlg-confirm" ref="confirmDialog" @close="closeConfirmation">
    <form method="dialog">
      <h3>{{ message.title }}</h3>
      <p>{{ message.body }}</p>
      <div class="toolbar">
        <button class="btn" value="no">Cancelar</button
        ><button class="btn danger" value="yes">Confirmar</button>
      </div>
    </form>
  </dialog>
</template>
