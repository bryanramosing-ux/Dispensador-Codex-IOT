# Dispensador IoT

Dashboard local para supervisar el ESP32, la ESP32-CAM y el dispensador de alimento. NestJS conserva las rutas del firmware, sirve el dashboard Vue y replica la actividad a Firebase. El historial, la última telemetría y las fotografías quedan disponibles en el equipo que ejecuta NestJS durante una pérdida de Internet.

```
ESP32 <── HTTP REST y descubrimiento UDP ──> NestJS <── REST, SSE y MJPEG ──> Vue
ESP32-CAM <── HTTP ────────────────────────> NestJS ──> Firestore y Cloud Storage
                                              │
                                              └── SQLite local y cola de sincronización
```

## Requisitos

- Node.js 24 LTS (24.15 o posterior) y npm 11. Python 3.10+ para la referencia de contrato y para importar datos antiguos. Java 21 para el emulador de Firestore.
- Proyecto Firebase, base Firestore en modo nativo y credenciales ADC para la nube. El bucket es opcional.
- PC de la LAN, Wi-Fi de 2,4 GHz para las placas y Arduino IDE o PlatformIO si hay que configurar y cargar firmware.

## Instalación y desarrollo

```bash
npm ci
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use un valor aleatorio distinto para `ADMIN_PASSWORD`, `SESSION_SECRET` y `TOKEN_DISPOSITIVO`. Configure `FIREBASE_PROJECT_ID` y la dirección de la ESP32-CAM. Genere los secretos en su equipo y guárdelos en `.env`, fuera de Git.

En terminales separadas, desde la raíz:

```bash
npm run dev:backend
npm run dev:frontend
```

Abra `http://localhost:5173` e inicie sesión con `ADMIN_PASSWORD`. Vite reenvía `/api` a NestJS en `127.0.0.1:8001`. Si el puerto cambia, pase a Vite `VITE_BACKEND_URL` con la nueva base.

Para servir ambos desde NestJS y conectar equipos de la LAN:

```bash
npm run build
npm start
```

En el PC abra `http://localhost:8001`. Para uso normal con credenciales administrativas utilice HTTPS en un proxy de la LAN, ajuste `COOKIE_SECURE=1`, configure `DASHBOARD_ORIGINS` y redirija el dashboard al mismo NestJS. Mantenga el listener HTTP para el acceso directo del ESP32 y el broadcast UDP. El protocolo del firmware transporta el token por HTTP. Separe el tráfico de dispositivos mediante firewall o una red IoT con acceso limitado al PC y las placas.

En Visual Studio Code, abra la carpeta raíz con `code .`, configure `.env` desde el explorador y ejecute **Terminal → Ejecutar tarea**. Inicie **NestJS (desarrollo)** y **Vue (desarrollo)** en terminales separadas. También puede ejecutar las tareas de compilación y pruebas desde allí. Use la extensión oficial Vue para soporte de archivos `.vue`; las extensiones de PlatformIO o Arduino sirven para trabajar con los sketches preservados.

## Firebase

1. Cree el proyecto y su base Firestore por defecto. Opcionalmente cree el bucket de Cloud Storage y copie su nombre exacto a `FIREBASE_STORAGE_BUCKET`.
2. Configure ADC mediante la identidad del entorno o `gcloud auth application-default login` para desarrollo. En una instalación con cuenta de servicio, configure `GOOGLE_APPLICATION_CREDENTIALS` con la ruta absoluta al JSON fuera del repositorio. La identidad requiere permisos de datos de Firestore y, si hay bucket, permisos sobre sus objetos. Admin SDK se ejecuta en NestJS.
3. Aplique las reglas y los índices desde la raíz al proyecto que administra.

```bash
firebase deploy --only firestore:rules,firestore:indexes --project ID_DEL_PROYECTO
firebase deploy --only storage --project ID_DEL_PROYECTO
```

Para desarrollo local, instale Firebase CLI y lance `firebase emulators:start --only firestore,storage --project demo-dispensador`. Ajuste `FIREBASE_PROJECT_ID=demo-dispensador`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` y, si prueba fotos en el bucket, `FIREBASE_STORAGE_BUCKET=demo-dispensador.appspot.com` y `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199`. Los hosts del emulador se escriben sin protocolo.

### Variables de entorno

| Variable | Uso y valor inicial |
| --- | --- |
| `HOST`, `PORT` | Escucha HTTP, por defecto `0.0.0.0:8001`. |
| `PUERTO_DESCUBRIMIENTO` | UDP `41234`. Con `0`, use `URL_BACKEND` explícita en la placa. |
| `ESP32_URL` | Opcional. Origen HTTP con IPv4 privada, recomendable fijarlo y reservar la IP en DHCP. Si está vacío, se usa el par TCP autenticado de la telemetría. |
| `ESP32_CAM_URL` | Origen HTTP con IPv4 privada, por defecto `http://192.168.1.51`. Cadena vacía usa la base del ESP32 si existe. |
| `TOKEN_DISPOSITIVO` | Token compartido con `secrets.h`. Vacío deja el control remoto deshabilitado y devuelve 401 en la ingesta. |
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Obligatorios. Contraseña de al menos 16 caracteres y secreto de firma de al menos 32. |
| `SESSION_TTL_S`, `COOKIE_SECURE` | Vida de sesión (28800 s) y cookie exclusiva de HTTPS (activar con `1` tras configurar TLS). |
| `DASHBOARD_ORIGINS` | Lista de orígenes HTTP(S) exactos separados por comas para CORS y CSRF. La interfaz servida en el mismo origen funciona sin CORS. |
| `ESP32_OFFLINE_S`, `CAMERA_POLL_S` | Umbral de 15 s y sondeo de 5 s. |
| `MIN_DISPENSE_GAP_S`, `MAX_PORCIONES` | Intervalo de 3 s y máximo de 3 porciones, dentro del límite del firmware. |
| `STORAGE_DIR` | Directorio privado del backend. Por defecto `.data` relativo a la raíz. Una instancia por directorio y proyecto. |
| `FIREBASE_PROJECT_ID` | ID obligatorio del proyecto o del emulador. |
| `FIREBASE_STORAGE_BUCKET` | Bucket opcional. Si queda vacío, los JPEG viven en SQLite y Firestore guarda metadatos. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta externa opcional a credenciales ADC. |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST` | Host:puerto opcional de cada emulador. |

## ESP32 y ESP32-CAM

1. Copie `secrets_ejemplo.h` a `secrets.h` dentro de [cada sketch](firmware/) y complete los valores de su LAN. El token del DevKit debe coincidir con el de NestJS. Reserve la IP del DevKit y de la cámara en el router si es posible.
2. Para el DevKit, deje `URL_BACKEND` vacía si la red admite UDP broadcast o configure `http://IP_LAN_PC:8001`. Proporcione acceso entrante al PC en TCP 8001 y UDP 41234 desde la red IoT. El backend siempre autentica por token la telemetría y las alertas.
3. La ESP32-CAM atiende en el puerto 80. Use en `ESP32_CAM_URL` la dirección real que presenta por serie. El backend llama `/status`, `/capture` y `/stream`. Ambas placas usan su [firmware original](firmware/).
4. Use la [guía de montaje](docs/guia_ensamblaje_protoboard.md) y el [manual de conexiones](docs/manual_instrucciones_conexiones.md). Presencia automática y botón de dispensación permanecen desactivados según la configuración auditada. El servicio histórico de visión se conserva en [hardware/OpenCV](hardware/OpenCV/README.md) y se ejecuta por separado si se habilita ese modo del firmware.

## HTTP, SSE y MJPEG

| Consumidor | Rutas principales |
| --- | --- |
| Firmware | `POST /api/device/telemetry`, `POST /api/device/alert` con `X-Device-Token`. |
| Dashboard | `GET /api/status`, `GET /api/events`, `GET /api/history`, `GET /api/gallery`, `GET /api/gallery/:name`, `GET /api/camera/stream`, `GET /api/camera/frame`. |
| Acciones | `POST /api/capture`, `POST /api/camera/refresh`, `POST /api/auto-capture`, `POST /api/dispense`, `POST /api/reset-errors`, `DELETE /api/gallery/:name`. |
| Operación | `GET /api/health` y `GET /api/health/sync` (sesión requerida para el estado de sincronización). |
| Sesión | `POST /api/session` recibe `{"password":"…"}`, `GET /api/session` devuelve `authenticated` y `POST /api/session/logout` limpia la cookie. |

Use cookie de administrador y `X-Requested-With: dashboard` para escrituras. Para dispensar envíe `{"porciones":1,"confirm":true}`; el cliente genera una `Idempotency-Key` por aprobación. La aceptación HTTP 202 registra la respuesta del ESP32. La telemetría posterior refleja el intento y el resultado del firmware. Para historia o galería, conserve el filtro y pase `?cursor=...` con el valor de `X-Next-Cursor` recibido en la página anterior.

El SSE abre con `event: status`, envía `event: evento` para entradas de historial y emite estado cada 2 s. El navegador vuelve a abrir el flujo tras un corte. El proxy MJPEG comparte una conexión de cámara entre espectadores, reabre el origen cuando la ESP32-CAM termina su lote y cede el recurso entre lotes a capturas y sondeos. Los JPEG puntuales usan `/api/camera/frame` y no se guardan en la galería.

Consulte todos los métodos, payloads y códigos en la [matriz de compatibilidad](docs/migration/compatibility.md).

## Persistencia e importación

Un SQLite local guarda las lecturas operativas, los JPEG y una cola de transacciones ordenadas. NestJS confirma la ingesta después de confirmar SQLite y replica la cola a Firestore sin bloquear al ESP32. Si hay bucket, la cola sube o elimina el objeto antes de confirmar sus metadatos en Firestore. Consulte el [esquema y recuperación](docs/firestore/schema.md).

Para importar datos del backend Python, pare el proceso Python que escribe en `backend/storage`, haga una copia de ese directorio y ejecute la importación antes del primer arranque de NestJS con un `STORAGE_DIR` limpio:

```bash
npm run build
npm run import:legacy -- /ruta/al/respaldo/backend/storage
npm start
```

La importación lee el SQLite antiguo en modo lectura, conserva IDs, fecha, ajustes y bytes JPEG y tolera repetir una exportación parcial. Revise `/api/health/sync` tras arrancar para comprobar que la cola llegó a Firestore. Importe una fuente por instalación.

## Pruebas

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
npm run verify:assets
firebase emulators:exec --only firestore,storage --project demo-dispensador 'npm run test:emulator'
make -C firmware/ESP32/test_host
python3 -m unittest discover -s hardware/Documentation/wiring/tests -v
```

Las pruebas diferenciales ejecutan el servidor Python auditado y NestJS contra dispositivos simulados. Las de integración cubren HTTP, UDP, SSE, MJPEG, pérdida de respuesta de la placa y reinicio. [Informe de validación](docs/migration/validation.md).

## Archivos y solución de problemas

| Ruta | Contenido |
| --- | --- |
| [apps/backend](apps/backend/) | API NestJS, seguridad, dispositivos, cámara, sincronización y pruebas. |
| [apps/frontend](apps/frontend/) | Vistas Vue, cliente de API y SSE, y estilos originales. |
| [firmware](firmware/) | DevKit, ESP32-CAM, stubs, pruebas, configuración y documentación de origen. |
| [hardware/Documentation](hardware/Documentation/) | Manual, calibración, video, esquemas, lista de materiales y scripts. |
| [assets/3d](assets/3d/) | STL, renders, generadores y plan de impresión. `00_Ensamblaje_Referencia_NO_IMPRIMIR.stl` es una referencia de armado. |
| [docs/migration](docs/migration/) | Auditoría, matriz, hashes y validación. |
| [scripts](scripts/) | Importación y comprobaciones. Referencia Python y dashboard originales para contrato. |

- **401 en telemetría.** Compruebe token, IP de origen real y `ESP32_URL`. El backend ignora cabeceras de IP de proxies para autenticar dispositivos.
- **Sesión rechazada o perdida.** Revise el origen permitido, el proxy y el uso de HTTPS si `COOKIE_SECURE=1`. Cambiar el secreto de sesión invalida las cookies existentes.
- **Cámara ocupada o sin video.** Compruebe `/status` de la cámara desde el PC, alimentación, dirección IP y Wi-Fi. Un navegador externo abierto contra el stream directo puede ocupar la cámara. El dashboard pasa a fotogramas si pierde MJPEG.
- **El comando quedó con resultado desconocido.** Revise estado e historial antes de confirmar otro envío. El servidor jamás reenvía por su cuenta un comando físico.
- **Cola Firestore creciendo.** Revise conectividad, proyecto, ADC, IAM, bucket y espacio de almacenamiento. Mantenga `STORAGE_DIR` al actualizar el backend y no borre su SQLite con transacciones pendientes.

Quedan pendientes el montaje y la comprobación con placas, sensores, servo y cámara reales. El servicio se dimensionó para un dispensador por instalación. La auditoría identifica la configuración eléctrica vigente y las ramas o documentos históricos. [Auditoría del origen](docs/migration/source-audit.md).
