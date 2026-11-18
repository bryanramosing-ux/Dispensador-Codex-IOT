# Auditoría del repositorio original

Repositorio [Proyecto-Dispensador-IOT](https://github.com/bryanramosing-ux/Proyecto-Dispensador-IOT). Rama predeterminada anunciada por GitHub y confirmada en el clon `fix/dos-sensores-manual-seguro-20261115`, commit [01d7ecd6ab3dec298c23e882c9e352de6288eb2b](https://github.com/bryanramosing-ux/Proyecto-Dispensador-IOT/tree/01d7ecd6ab3dec298c23e882c9e352de6288eb2b). El [árbol completo](source-tree.txt) detalla los 166 archivos versionados, sus tamaños y objetos Git.

## Backend Python

`backend/dashboard_server.py` usa `ThreadingHTTPServer` y biblioteca estándar de Python 3.10+. Los valores por defecto incluyen HTTP :8001, UDP :41234, cámara 192.168.1.51, sondeo cada 5 s, ESP32 desconectado después de 15 s, máximo 3 porciones y brecha de 3 s entre comandos. `backend/.env.example` documenta configuración, `backend/requirements.txt` solo menciona Pillow opcional para el simulador.

| Método y ruta | Entrada | Respuestas observadas en el código |
| --- | --- | --- |
| GET `/`, `/index.html`, `/styles.css`, `/app.js` | — | 200 HTML, CSS o JS, 404 si falta archivo |
| GET `/api/health` | — | 200 `{status:"ok",uptime_s}` |
| GET `/api/status` | — | 200 instantánea descrita abajo |
| GET `/api/history` | `limit` por defecto 100, limitado a 1–500, `tipo` exacto opcional | 200 `{items:[{id,ts,tipo,mensaje}]}`, ID entero descendente |
| GET `/api/gallery` | — | 200 `{items:[{name,size,ts}]}`, hasta 500 |
| GET `/api/gallery/:name` | Nombre URL-encoded, `download=1` opcional | 200 JPEG inline/attachment, 404 si falta o nombre inválido |
| DELETE `/api/gallery/:name` | `X-Requested-With: dashboard` y `X-Confirm: delete` | 200 `{ok:true,deleted}`, 400 sin confirmar, 403 guardia, 404 nombre inválido/ausente |
| GET `/api/events` | Flujo SSE | 200, evento inicial `status`, luego `status` y `evento`, comentario `: keepalive` tras 15 s sin mensajes |
| GET `/api/camera/stream` | — | 200 MJPEG `boundary=esp32cam`, 503 cámara desconectada |
| GET `/api/camera/frame` | — | 200 JPEG temporal, 409 cámara ocupada si su HTTP devuelve 409, 503 resto de fallos |
| POST `/api/device/telemetry` | Cabecera `X-Device-Token` si configurada y objeto JSON con `dispositivo:"ESP32"` | 200 `{ok:true}`, 400 JSON/dispositivo, 401 token, 413 longitud |
| POST `/api/device/alert` | Token, JSON `{dispositivo,tipo,nivel}`, solo `tipo` validado tras truncar a 32 caracteres (`[A-Z_]`) | 200 `{ok:true}`, 400 JSON/tipo, 401 token, 413 longitud |
| POST `/api/capture` | Guardia dashboard | 200 `{ok:true,name,size}`, 403 guardia, 503 captura fallida |
| POST `/api/dispense` | Guardia, `{porciones:entero,confirm:true}` | 400 JSON/confirmación/rango, 403 control deshabilitado, 409 ocupado, 429 brecha, 503 sin conexión, o código y objeto JSON del ESP32, incluido 202 |
| POST `/api/reset-errors` | Guardia dashboard | 403 control deshabilitado, 503 fallo de conexión/desconocido, o código y JSON del ESP32 |
| POST `/api/auto-capture` | Guardia, `{interval_s:entero}` = 0 o 10–3600 | 200 `{ok:true,auto_capture_s}`, 400 cuerpo/intervalo, 403 guardia, 413 longitud |
| POST `/api/camera/refresh` | Guardia dashboard | 200 `{ok:true,online}` incluido si la cámara cayó, 403 guardia |
| Otras rutas GET, POST o DELETE | POST/DELETE atraviesan guardia | 404 `{error:"ruta no encontrada"}` después de la guardia |

Referencias por secciones en el original: [estado y persistencia](https://github.com/bryanramosing-ux/Proyecto-Dispensador-IOT/blob/01d7ecd6ab3dec298c23e882c9e352de6288eb2b/backend/dashboard_server.py#L104-L227), [cámara y comandos](https://github.com/bryanramosing-ux/Proyecto-Dispensador-IOT/blob/01d7ecd6ab3dec298c23e882c9e352de6288eb2b/backend/dashboard_server.py#L229-L367) y [controladores HTTP](https://github.com/bryanramosing-ux/Proyecto-Dispensador-IOT/blob/01d7ecd6ab3dec298c23e882c9e352de6288eb2b/backend/dashboard_server.py#L382-L630).

- La instantánea tiene `ts,backend_uptime_s,esp32,camera,auto_capture_s,max_portions,remote_commands,last_photo`. ESP32 expone `online,age_s,ip,data,last_data` y cámara `online,age_s,url,data`. Se anula `data` al desconectar. `ts` es ISO UTC con segundos y sufijo `+00:00`. `evento` SSE contiene `ts,tipo,mensaje`. El watchdog emite `status` cada 2 s. La cola por cliente es de 50 mensajes.
- Cuerpo JSON hasta 8192 bytes, objeto obligatorio donde aplica, errores `{ok:false,error}`. La guardia de escritura comprueba `X-Requested-With: dashboard` y, si viene, host de `Origin`. En origen las lecturas estaban abiertas, la guardia no comprobaba identidad y el token de dispositivo vacío permitía ingreso sin autenticación.
- Cada telemetría sustituye la instantánea. Se registra conexión, cambio de estado, error nuevo y cambio de contador después de la primera muestra. IP declarada con respaldo a la dirección remota. No se conservan muestras crudas ni deduplican reportes. SQLite guarda `eventos(id,ts,tipo,mensaje,dato)` y el historial lo consulta. Ajuste en `settings.json`, JPEG en `gallery/` con reemplazo atómico, máximo 5 MiB por imagen y prefijo JPEG, nombres `foto_YYYYMMDD_HHMMSS_xxxxxx.jpg`.
- ESP32 recibe formularios `POST /dispensar` con `porciones,token` y `POST /reset-errores` con `token`. Tiempo de espera 5 s. Dispensar requiere confirmación, dispositivo conectado, máximo configurado y exclusión mutua, respeta frecuencia y señal `dispensando`. El 202 confirma aceptación de solicitud. La dosificación se ejecuta y confirma en firmware mediante su estado y telemetría.
- Cámara se consulta con `GET /status` (3 s), `/capture` (8 s) y `/stream` (5 s por conexión). El proxy usa exclusión mutua con consultas y capturas y vuelve a abrir la conexión MJPEG. Si URL de cámara queda vacía, hay respaldo a la base del ESP32. La captura automática registra errores y solo corre con cámara disponible.
- OpenCV es otro servicio Python (puerto 8000, `OpenCV/servidor_vision.py`), con GET `/`, `/status`, `/classify?dist=`, `/panel.json`, `/ultima.jpg` y POST `/alerta`. Clasifica con MobileNetV2, consulta cámara y mantiene capturas propias. El modo que lo consume está deshabilitado en el firmware auditado. Se conserva como servicio opcional.

## Dashboard

`frontend/index.html`, `frontend/styles.css` y `frontend/app.js`, JavaScript del navegador sin framework, empaquetador, router ni dependencias. Documento único con navegación por pestañas Panel, Cámara, Galería, Control e Historial. CSS oscuro con tipografía de sistema, icono de texto y media queries. Panel con tarjetas, indicador de nivel, gráfico Canvas de distancia, última foto y alertas. Cámara usa una etiqueta img con MJPEG, fotograma cada 3 s si `stream` es falso, captura manual, reconsulta y captura automática. Galería ordenable con visor, descarga y borrado confirmado. Control con selector de porciones, diálogo de confirmación, resultado y borrado de errores. Historial filtrable y recargado por SSE. HTTP relativo al mismo origen, EventSource con reintento a 3 s y detección de flujo mudo tras 20 s. Vue 3 puede conservar estructura/clases y CSS, sustituyendo mutaciones del DOM por plantillas y servicios tipados.

## Firmwares

- `ESP32/Dispensador_ESP32/{Red.cpp,Red.h,Dispensador_ESP32.ino,config.h}`: servidor HTTP :80, mDNS `dispensador.local`, `GET /status` y POST autenticados descritos antes. Devuelve 202 para pedido aceptado, 409 para conflicto (incluidos cooldown y tolva), 400 por porciones inválidas, 403 por deshabilitado/sin token, 401 por token incorrecto, 429 durante bloqueo y 200 al borrar errores. Descubrimiento por broadcast UDP :41234 pregunta `DISPENSADOR?`, espera `DISPENSADOR!<puerto>`, toma IP del remitente y reintenta a los 3 s. `URL_BACKEND` en `secrets.h` permite omitir descubrimiento. Telemetría cada 2 s y en cambios, backoff hasta 30 s, timeouts 800/1500 ms. Alerta `{dispositivo:"ESP32",tipo,nivel}` con nivel en %, reintento a 30 s. Éxito requiere HTTP 200.
- El JSON de estado incluye cadenas `dispositivo,fw,modo,estado,error,ip,alerta_tolva,servo,ultimo_origen,ultimo_resultado,ultimo_motivo`, booleanos `wifi_conectado,backend,sensor_nivel_ok,alerta_pendiente,dispensando` y números `rssi,distancia_nivel_cm,nivel_tolva,pulso_servo_us,dispensaciones_total,dispensaciones_24h,ultima_dispensacion_hace_s,ultimas_porciones,cooldown_s,max_porciones,distancia_cm,ultima_clase,ultima_confianza,raciones_perro,raciones_gato,raciones_manual,v_servo,v_bateria,uptime_s,heap`. Conserva los valores de ausencia del firmware, incluidas lecturas negativas. Distancias en cm, RSSI en dBm, voltajes en V, pulso en µs y tiempos de telemetría en segundos.
- HC-SR04 tolva GPIO19/21, presencia GPIO26/34, servo GPIO25, BOOT GPIO0, LED GPIO2. Medición de nivel cada 5 s, control cada 50 ms, rampa de 10 µs por 10 ms, llenado 700 ms y descarga 600 ms. Límites, enfriamiento, NVS y calibración en `Controlador.cpp`, `Dosificador.cpp`, `HistorialNVS.h` y `config.h`. Presencia automática y botón de dispensación desactivados. El modo opcional usa `URL_VISION` y `URL_CAMARA`, cámara/visión `GET /status`, visión `GET /classify?dist=` con conexión 2 s y respuesta 10 s.
- `ESP32_CAM/Camara_ESP32CAM/{Camara_ESP32CAM.ino,config.h,secrets_ejemplo.h}`: AI-Thinker HTTP :80, IP inicial 192.168.1.51, JPEG VGA (calidad 12), flash GPIO4 apagado por configuración. GET `/status` 200/503 con `camara,psram,fotos_ok,fotos_fallidas,rssi,heap,uptime_s,stream,resolucion,ip`. GET `/capture` 200 JPEG o 503 JSON, GET `/stream` con `boundary=esp32cam`, hasta 20 frames con pausa de 100 ms y encabezado JPEG y tamaño por parte. Reconexión Wi-Fi a 5 s y reinicio tras 120 s sin Wi-Fi. Conservación íntegra de pines de la OV2640 y del código.

## Activos y comprobaciones existentes

- `Mechanical/STL/` tiene 23 STL y ningún OBJ versionado. `Mechanical/render/`, generadores y plan de impresión complementan el conjunto.
- `Documentation/` contiene manual Markdown/PDF e imágenes, esquemas SVG/PNG y scripts, lista de materiales CSV, calibración, potencia, operación y video de montaje MP4/SRT con fuentes. `docs/` contiene arquitectura local, guías de conexiones, planos de protoboard SVG/PNG, CSV e informe de pruebas.
- Ambos firmwares incluyen `platformio.ini` y cabeceras de ejemplo para secretos locales. `ESP32/test_host/` trae pruebas C++, stubs y script QEMU. `backend/tests/` contiene pruebas HTTP y simulador de dispositivos. `OpenCV/tests/` cubre clasificación, operaciones y modelo real, con `requirements.txt` separado. `.github/workflows/verificacion.yml` cubre los anteriores, chequeos mecánicos, Arduino 2.x/3.x y QEMU.
- Referencia ejecutada con `python3 -m unittest discover -s backend/tests -v`: 24 pruebas correctas, con dispositivos simulados. El entorno de auditoría carece de hardware conectado.
