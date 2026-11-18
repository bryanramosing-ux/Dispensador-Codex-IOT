# Esquema y sincronización de Firestore

El backend es el único cliente de Firebase Admin. Configura ADC desde la identidad del entorno o una ruta externa a la cuenta de servicio. Las reglas versionadas cierran acceso directo a los clientes. El backend sirve HTTP mediante autenticación propia para la LAN.

| Colección | ID | Datos |
| --- | --- | --- |
| `telemetry` | UUID generado al admitir una muestra nueva | `deviceId:esp32,ts,ip,payload`. `payload` conserva nombres, sentinelas y unidades del firmware. |
| `device_status` | `esp32`, `camera` | `online,seen,data`, y para el ESP32 `ip` observada. `seen` es epoch en milisegundos. |
| `history` | ID entero rellenado a 14 dígitos como ID de documento | `id,ts,tipo,mensaje` para el historial público con sesión. Las dispensaciones del firmware y los resultados de comandos aparecen como entradas distintas. |
| `events` | Mismo ID de documento que la entrada de historial | `id,ts,tipo,mensaje,detalle`. Incluye detalles de alertas, resultado observado del firmware e ID del comando cuando corresponde. |
| `commands` | UUID o `request-<Idempotency-Key>` | `operation,portions,confirmed,requestedAt,state,status,response,finishedAt`. `dispatching`, `accepted`, `rejected` y `outcome_unknown` distinguen envío, aceptación, rechazo y ausencia de confirmación. |
| `photos` | Nombre de archivo original o generado | `name,size,ts,objectPath`. `objectPath` apunta a `gallery/NOMBRE.jpg` cuando hay bucket. |
| `settings` | `dashboard`, `last-alert`, `last-dispense`, `_sync-<uuid>` | Intervalo automático, deduplicación de alertas, límite temporal y secuencia confirmada del backend. |

`recordedAt` es un Timestamp de Firestore obtenido de la fecha en ms del registro local. Las rutas heredadas expresan `ts` en UTC con precisión de segundos y `+00:00`. Los cursores usan fecha e ID, ambos descendentes. Los índices compuestos de `history` y `events` soportan filtros por `tipo`; Firestore añade el desempate por nombre en la misma dirección. La desindexación de `payload` y `data` reduce el coste de escribir instantáneas.

## Funcionamiento sin Internet

El proceso confirma el evento, la proyección local y su entrada en la cola en una transacción SQLite WAL con `synchronous=FULL`. En caso de caída de Firebase, el dashboard lee la proyección local y la ingesta del ESP32 responde tras esa transacción. La cola también sobrevive a reinicios de NestJS. Los JPEG se guardan como BLOB local de hasta 5 MiB, con eliminación lógica inmediata y borrado del BLOB tras sincronizar el borrado. Otros errores de almacenamiento local siguen produciendo un fallo HTTP.

Un consumidor procesa hasta 25 entradas por ronda en orden de secuencia, con una sola ronda activa. Firestore actualiza documentos y marcador de secuencia atómicamente, con hasta tres intentos de transacción del SDK. Cuando falla, el consumidor vuelve a intentar con espera exponencial de 0,5–60 s más jitter. Una entrada que falla conserva su lugar y permite recuperar la secuencia consultando `/api/health/sync` y los registros. Un bucket mal configurado puede bloquear detrás de una fotografía otras escrituras de la cola. Corrija IAM o el nombre del bucket antes de reanudar.

Cada entrada conserva IDs y fecha entre intentos. Un acuse perdido tras un commit se reconoce consultando la secuencia confirmada y no vuelve a aplicar la mutación. El firmware no envía ID de mensaje. Una telemetría idéntica a la anterior del mismo par refresca la conexión sin insertar otra muestra cruda. Una alerta consecutiva con los mismos datos en 35 s se trata como posible reenvío. Dos alertas realmente distintas pero idénticas dentro de ese intervalo son indistinguibles con el protocolo actual.

La cola realiza la operación del objeto antes de publicar sus metadatos. La ruta del objeto es estable y el borrado tolera ausencia previa. Firestore y Cloud Storage son dos servicios; una caída entre ambas operaciones puede dejar el objeto más adelantado que sus metadatos hasta la próxima sincronización. El video se retransmite en memoria.

Use un volumen persistente privado, una instancia por instalación y espacio adecuado para su volumen de telemetría y fotos. SQLite impide una segunda apertura concurrente del mismo directorio. El servicio conserva una proyección local para sostener consultas e imágenes durante cortes. Rotación de históricos, reconstrucción de SQLite desde la nube y despliegue activo-activo requerirían un procedimiento adicional. Respaldar el volumen es especialmente importante si Cloud Storage está deshabilitado.
