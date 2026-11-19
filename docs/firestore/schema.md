# Firestore del dispensador

Firebase Admin crea las colecciones a partir de la primera escritura. Usa Cloud Firestore en modo nativo, base `(default)`. Las reglas bloquean el acceso directo de los SDK de cliente y el REST con tokens de usuarios. El navegador usa las rutas autenticadas de Next.js, y el servidor accede con su identidad de servicio. [Configuración de Firebase](../manual_software.md#2-crear-y-configurar-firebase).

| Colección | Identificador | Campos principales | Escritura |
|---|---|---|---|
| `operators` | UID de Firebase Auth | `active` booleano, `updatedAt` Timestamp | `pnpm firebase:operator grant/revoke UID` o Firebase Console |
| `device_status` | `esp32` y `camera` | `data` último estado, `sentAt` segundos Unix de la placa, `seen` ms Unix de recepción, `recordedAt` Timestamp | Mensajes MQTT de estado |
| `telemetry` | ID generado | `deviceId`, `ts` ISO 8601, `recordedAt` Timestamp, `sentAt` segundos Unix, `payload` | Muestras aceptadas del controlador |
| `history` | ID generado | `ts` ISO 8601, `recordedAt` Timestamp, `tipo`, `mensaje`, `detail` opcional | Conexión, estado, error, alerta, dosis, comando y foto |
| `commands` | UUID de la petición | `operation`, `portions`, `requestedBy`, `recordedAt`, `expiresAt`, `lockUntil`, `state`, `finishedAt`, `result` opcional | Operaciones del panel |
| `settings` | `dashboard`, `command_dispatch`, `last-mqtt-alert` | Intervalo `auto_capture_s`, turno de comando y última alerta para deduplicación | Panel y monolito |
| `photos` | Nombre JPEG | `name`, `ts`, `size`, `recordedAt`, `source` | Metadatos de captura |
| `photo_images` | Mismo nombre JPEG | `bytes` de Firestore, hasta 400 000 bytes | Imagen de la captura |

`commands.state` puede ser `pending`, `accepted`, `rejected` u `outcome_unknown`. Una orden pendiente que venció durante una interrupción se registra como resultado desconocido al consultar el mismo UUID por la API. El bloqueo de envío vence automáticamente.

Firestore ordena historial y fotos por `recordedAt` e ID de documento. El índice para filtrar `history` por `tipo` está en `firestore.indexes.json`. El índice de `events` sirve para consultas históricas. Los mapas de telemetría y el campo de bytes están desindexados.

La API guarda o borra el JPEG y sus metadatos de forma atómica. El listado de la galería consulta `photos` y lee el JPEG de `photo_images` al abrir o descargar una foto. La vista previa muestra fotogramas sin guardarlos. Cada captura guardada ocupa espacio del proyecto Firestore.

## Capturas existentes de la versión anterior

Al reutilizar el mismo proyecto, el historial y los metadatos de fotos siguen disponibles. Si una foto antigua tiene `objectPath`, recupera su archivo JPEG desde el bucket anterior o una copia de respaldo y ejecuta:

~~~bash
pnpm firebase:import-photo NOMBRE_DEL_DOCUMENTO_FOTO RUTA_DEL_JPEG
~~~

Usa un JPEG de hasta 400 000 bytes. El comando usa el documento existente de `photos`, conserva sus datos históricos y agrega los bytes al documento correspondiente de `photo_images`. Repetir el comando con el mismo archivo es seguro. Si quedan datos pendientes en el volumen SQLite de una instalación anterior, conserva la copia y completa la sincronización de esa versión antes del cambio.
