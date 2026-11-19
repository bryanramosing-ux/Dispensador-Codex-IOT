# Firestore del dispensador

El SDK de Firebase Admin crea las colecciones a partir de la primera escritura. Use Cloud Firestore en modo nativo, base predeterminada `(default)`. El navegador consulta la API de Next.js. Las reglas bloquean el acceso directo de los SDK de cliente y del REST con tokens de usuarios. Firebase Admin utiliza los permisos IAM de su identidad. [Configuración de Firebase](../manual_software.md#2-crear-y-configurar-firebase).

| Colección | Identificador | Campos principales | Escritura |
|---|---|---|---|
| `operators` | UID de Firebase Auth | `active` booleano, `updatedAt` Timestamp | `pnpm firebase:operator grant/revoke UID` o Firebase Console |
| `device_status` | `esp32` y `camera` | `data` último estado, `sentAt` segundos Unix del dispositivo, `seen` ms Unix de recepción, `recordedAt` Timestamp | Mensajes MQTT de estado |
| `telemetry` | ID generado | `deviceId`, `ts` ISO 8601, `recordedAt` Timestamp, `sentAt` segundos Unix, `payload` | Muestras aceptadas del controlador |
| `history` | ID generado | `ts` ISO 8601, `recordedAt` Timestamp, `tipo`, `mensaje`, `detail` opcional | Conexión, estado, error, alerta, dosis, comando y foto |
| `commands` | UUID de la petición | `operation`, `portions`, `requestedBy`, `recordedAt`, `expiresAt`, `lockUntil`, `state`, `finishedAt`, `result` opcional | Operaciones del panel |
| `settings` | `dashboard`, `command_dispatch`, `last-mqtt-alert` | Intervalo `auto_capture_s`, turno de comando y última alerta para deduplicación | Panel y monolito |
| `photos` | Nombre JPEG | `name`, `ts`, `size`, `recordedAt`, `objectPath`, `source` | Captura manual o automática |

`commands.state` puede ser `pending`, `accepted`, `rejected` u `outcome_unknown`. Tras una interrupción del proceso, un comando pendiente y vencido se considera de resultado desconocido al consultar el mismo UUID mediante la API. El bloqueo de envío vence automáticamente.

Firestore ordena historial y fotos por `recordedAt` y por ID de documento. El índice para `history` filtrado por `tipo` se define en `firestore.indexes.json`. Se conservó el índice anterior de `events` para consultas históricas. Los mapas de telemetría y estado se excluyen de la indexación. Revise el volumen y la retención de muestras y fotos según sus necesidades operativas.

Para la galería, `objectPath` tiene el formato `gallery/<nombre>` en Cloud Storage. Los archivos se leen y borran desde la API autenticada. Un fallo entre la carga del JPEG y la escritura en Firestore puede dejar un objeto sin metadatos. Si se interrumpe una captura y la foto no aparece, compruebe el objeto en el bucket y que no exista el documento de la galería antes de borrarlo.

## Datos de la versión anterior

Al apuntar al mismo proyecto, el panel puede leer el historial y las fotos sincronizadas por el backend anterior. Para que las fotos aparezcan con su imagen, conserve el bucket original y los documentos `photos` con `objectPath`. El nuevo código escribe los eventos en `history` y usa los mismos nombres de colección para las proyecciones compartidas. Los documentos anteriores de `events` y el marcador de sincronización quedan accesibles para consultas administrativas.

Si hay datos pendientes en el almacén SQLite anterior, mantenga una copia de su volumen y finalice la sincronización de la versión anterior antes de apagarla. Las fotos que solo existen en SQLite requieren exportarse desde el entorno anterior. Para una instalación nueva, las colecciones se llenan a medida que se autorizan operadores, se conectan las placas y se usa el panel.
