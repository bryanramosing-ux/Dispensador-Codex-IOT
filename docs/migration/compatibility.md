# Matriz de compatibilidad

El [contrato diferencial](../../apps/backend/test/contract.spec.ts) ejecuta simultáneamente NestJS y la copia del backend Python auditado. Las [pruebas de integración](../../apps/backend/test/integration.spec.ts) usan HTTP y UDP reales en localhost con placas simuladas. Para el comportamiento previo y sus referencias consulte la [auditoría](source-audit.md).

| Ruta original | Método | Entrada | Respuesta esperada | Consumidor | Implementación | Comprobación |
| --- | --- | --- | --- | --- | --- | --- |
| `/`, `/index.html` | GET | — | 200 HTML | Navegador | `main.ts` y build Vite | Chromium, archivos Vite |
| `/styles.css`, `/app.js` | GET | — | 200 CSS/JavaScript | Navegador | `main.ts` y nombres de salida Vite | Chromium, build |
| `/api/device/telemetry` | POST | `X-Device-Token`, JSON con `dispositivo:"ESP32"`, estado, sensores, servo y contadores en unidades originales | 200 `{ok:true}`, 400 JSON/dispositivo, 401 token, 413 tamaño | ESP32 `Red.cpp` | `TelemetryController.receive` | Diferencial y emulador |
| `/api/device/alert` | POST | Token y JSON `{dispositivo,tipo,nivel}` | 200 `{ok:true}`, 400 cuerpo/tipo inválido, 401 token, 413 tamaño | ESP32 `Red.cpp` | `TelemetryController.alert` | Diferencial, SSE, emulador |
| `/api/status` | GET | Cookie | 200 `{ts,backend_uptime_s,esp32,camera,auto_capture_s,max_portions,remote_commands,last_photo}` | Vue, sondeo de respaldo | `DevicesController.status` | Diferencial, reinicio |
| `/api/events` | GET | Cookie | 200 `text/event-stream`, `status` inicial, `status`/ `evento` posteriores | Vue, EventSource | `DevicesController.events`, `SseService` | Diferencial y reconexión HTTP |
| `/api/history` | GET | Cookie, `limit`, `tipo`, `cursor` opcionales | 200 `{items:[{id,ts,tipo,mensaje}]}` | Vue, Historial | `HistoryController.list` | Diferencial, paginación e índices |
| `/api/gallery` | GET | Cookie, `limit,cursor` opcionales | 200 `{items:[{name,size,ts}]}` | Vue, Galería | `CameraController.gallery` | Diferencial y reinicio |
| `/api/gallery/:name` | GET | Cookie, nombre validado, `download=1` | 200 JPEG con `Content-Disposition`, 404 nombre inválido/ausente | Vue, galería y última foto | `CameraController.photo` | Diferencial de bytes y ruta |
| `/api/gallery/:name` | DELETE | Cookie, `X-Requested-With: dashboard`, `X-Confirm: delete` | 200 `{ok:true,deleted}`, 400 sin confirmación, 404 ausente | Vue, eliminar | `CameraController.delete` | Diferencial y emulador |
| `/api/camera/stream` | GET | Cookie | 200 `multipart/x-mixed-replace; boundary=esp32cam`, 503 cámara desconectada | Vista Cámara | `CameraController.stream`, `upstreamFrames` | Diferencial 503, integración 200 y reconexión |
| `/api/camera/frame` | GET | Cookie | 200 JPEG temporal, 409 cámara ocupada, 503 error | Vue, alternativa a MJPEG | `CameraController.frame` | Diferencial de bytes/código y Chromium |
| `/api/camera/refresh` | POST | Cookie, cabecera dashboard | 200 `{ok:true,online}` | Vue, actualizar | `CameraController.refresh` | Diferencial y Chromium |
| `/api/capture` | POST | Cookie, cabecera dashboard | 200 `{ok:true,name,size}`, 503 error | Vue, capturar | `CameraController.capture` | Diferencial, emuladores, Chromium |
| `/api/auto-capture` | POST | Cookie, cabecera dashboard, `{interval_s:entero}`, 0 o 10–3600 | 200 `{ok:true,auto_capture_s}`, 400 inválido | Vue, intervalo | `CameraController.auto` | Diferencial y persistencia |
| `/api/dispense` | POST | Cookie, cabecera dashboard, `{porciones:entero,confirm:true}`, `Idempotency-Key` opcional | 400 inválido, 403 sin token, 409 ocupado, 429 brecha, 503 desconectado/desconocido, o código y JSON del ESP32, incluido 202 | Vue, Control | `CommandsController.dispense`, `CommandsService.execute` | Diferencial, idempotencia y desconexión |
| `/api/reset-errors` | POST | Cookie, cabecera dashboard | Código/JSON ESP32 o 403/503 | Vue, Control | `CommandsController.reset` | Diferencial |
| `/api/health` | GET | — | 200 `{status:"ok",uptime_s}` | Operador | `HealthController.health` | Diferencial |
| `:41234` | UDP | `DISPENSADOR?` | `DISPENSADOR!<puerto>` | ESP32, LAN | `DevicesService` | Socket UDP de integración |
| ESP32 `/dispensar`, `/reset-errores` | POST | Formulario `porciones,token` o `token` | 202/200, 400/401/403/409/429 o fallo de red | NestJS | `CommandsService.dispatch` | Diferencial verifica formulario y códigos |
| ESP32-CAM `/status`, `/capture`, `/stream` | GET | — | Estado JSON, JPEG, MJPEG `esp32cam` | NestJS | `CameraService`, `edgeRequest`, `upstreamFrames` | Dispositivo simulado, fragmentos y cierre por lote |
| OpenCV `/status`, `/classify?dist=`, `/alerta`, `/panel.json`, `/ultima.jpg`, `/` | GET, POST para `/alerta` | Protocolo de visión opcional | Gestionado por Python original | ESP32 en modo opcional, operador | Servicio [preservado](../../hardware/OpenCV/) | Se conserva separado según la configuración vigente |

## Adaptaciones explícitas

- Las lecturas sensibles requieren sesión y devuelven 401 sin ella. La cabecera antigua de CSRF sigue siendo obligatoria para escrituras administrativas y puede devolver 403. La ingesta con token vacío devuelve 401. Se mantiene el header usado por el firmware. Las nuevas rutas de sesión y `/api/health/sync` son adicionales.
- El backend usa la IP TCP autenticada o el destino privado configurado. La IP incluida por el dispositivo se conserva dentro de su telemetría. Se rechazan redirecciones HTTP y hosts no privados. En red se requiere conexión directa del ESP32 o un proxy TCP que preserve la IP de origen.
- El backend comprueba tipos de campos conocidos y admite extensiones escalares de telemetría, con el tope de 8 KiB. Las cargas idénticas consecutivas y alertas idénticas dentro de la ventana de reenvío tienen tratamiento de deduplicación. Los nombres de campos del firmware y sus unidades se preservan.
- La paginación usa `X-Next-Cursor` sin añadir campos al cuerpo histórico. El criterio es fecha descendente y después ID descendente. En el original ordenaba por ID, una diferencia observable si el reloj retrocede.
- SSE conserva los nombres de eventos y el JSON. El límite es 32 conexiones; MJPEG comparte un origen y admite 6 espectadores. Se devuelve 429 al agotar capacidad o cuota. El proxy recupera tanto lotes regulares como el caso del WebServer Arduino que declara tamaño cero y escribe las partes después.
- Los mensajes de red se limitan a errores sanitizados. Un timeout de un comando queda con resultado desconocido y permite confirmar el estado por telemetría. Los códigos de aceptación y de rechazo del firmware se propagan.
