# Arquitectura del monolito Next.js

~~~mermaid
flowchart LR
    P["Navegador (React)"] -->|"HTTPS, ID token"| N["Next.js · API y cliente MQTT"]
    P -->|"Inicio de sesión"| A["Firebase Authentication"]
    N -->|"Firebase Admin"| A
    N --> F["Cloud Firestore · datos y JPEG"]
    N <-->|"MQTT/TLS"| M["Broker MQTT público con autenticación"]
    M <-->|"MQTT/TLS"| E["ESP32 DevKit"]
    M <-->|"MQTT/TLS"| C["ESP32-CAM"]
    X["MQTTX · diagnóstico"] --> M
~~~

`src/app` contiene las páginas y las rutas HTTP. Los componentes React están en `src/components` y los contratos compartidos en `src/lib/contracts.ts`. `src/lib/server` contiene Firebase Admin, el cliente MQTT y los módulos de persistencia, comandos y cámara. Next.js abre la conexión MQTT al iniciar y mantiene una suscripción en el mismo proceso Node.js que sirve la API.

El navegador inicia sesión con Firebase Authentication y envía un ID token en las peticiones a la API. El servidor verifica la validez y vigencia de la cuenta y requiere un documento de operador activo. El código del navegador recibe la configuración pública de Firebase. Las credenciales de Firebase Admin y del broker residen en el servidor.

## Temas MQTT y ACL

Prefijo común `dispensador/<MQTT_SITE_ID>`. Cada fila indica los permisos mínimos del broker. Use una credencial por actor, sesión limpia y publicaciones **QoS 0** con **Retain desactivado**. El broker debe rechazar publicaciones que activen Retain en los temas de solicitudes si ofrece esa opción. El navegador se conecta por HTTPS a Next.js.

| Sufijo | Publica | Se suscribe | Contenido |
|---|---|---|---|
| `/esp32/telemetry` | Controlador | Next.js | `{"sentAt": epochSegundos, "data": { "dispositivo": "ESP32", "estado": "ESPERANDO", … }}` |
| `/esp32/alert` | Controlador | Next.js | `{"sentAt": epochSegundos, "data": {"tipo":"COMIDA_BAJA","nivel":12}}` |
| `/esp32/command` | Next.js | Controlador | `{"id": "uuid", "operation": "dispense", "portions": 1, "expiresAt": epochSegundos}` |
| `/esp32/ack` | Controlador | Next.js | `{"id":"uuid","ok":true,"resultado":"ACEPTADA","cooldown_s":0}` |
| `/camera/status` | Cámara | Next.js | `{"sentAt": epochSegundos, "data": {"camara":true,"resolucion":"VGA 640x480"}}` |
| `/camera/request` | Next.js | Cámara | `{"id":"uuid","expiresAt":epochSegundos}` |
| `/camera/frame/<uuid>` | Cámara | Next.js, patrón `/camera/frame/+` | JPEG binario de hasta 400 000 bytes |

Para `reset-errors` el campo `portions` lleva `null`. Configure la ACL de MQTTX en modo de solo lectura con los temas de telemetría, estado y alerta. El controlador publica cada 15 s y cuando cambia su estado. La cámara publica cada 30 s y al cambiar la disponibilidad. El panel considera desconectado al ESP32 después de 50 s sin mensaje y a la ESP32-CAM después de 90 s.

## Comandos y cámara

El servidor valida la confirmación y el rango de porciones. Firestore reserva el identificador del comando y el turno de envío en una transacción. Se emite una única orden MQTT con vencimiento de ocho segundos. El firmware descarta mensajes que vencieron y UUID recientes, y delega la ejecución a la máquina de estados existente. La placa conserva sus validaciones de tolva, cooldown, límite diario y estado del servo. Un acuse `ACEPTADA` confirma la solicitud. El resultado de la dosis llega en telemetría. Si se pierde el acuse, el comando queda con resultado desconocido y el historial permite verificarlo antes de solicitar otra dosis.

La vista remota solicita JPEG sucesivos mientras está abierta. El monolito comparte las solicitudes de fotograma simultáneas. Las capturas manuales y periódicas guardan en Firestore el JPEG y sus metadatos en dos documentos escritos de forma atómica. La ESP32-CAM conserva el HTTP local utilizado por el clasificador OpenCV opcional. El control por botón BOOT y monitor serie depende de la placa y funciona fuera de la conexión con el monolito.

## API

Envíe `Authorization: Bearer <ID_TOKEN>` en las rutas protegidas.

| Ruta | Uso |
|---|---|
| `GET /api/health` | Comprobar que el proceso responde |
| `GET /api/session`, `GET /api/dashboard` | Verificar permiso de operador y obtener estado |
| `POST /api/commands` | Enviar `id`, `operation` y, para dispensar, `portions` y `confirm: true` |
| `GET /api/history?tipo=&limit=&cursor=` | Historial paginado |
| `GET /api/camera/frame`, `POST /api/camera/capture` | Solicitar un JPEG y guardar una foto, respectivamente |
| `PUT /api/camera/settings` | Actualizar `interval_s` (0 o 10–3600) |
| `GET /api/gallery`, `GET /api/gallery/<nombre>` | Listar fotos y consultar JPEG |
| `DELETE /api/gallery/<nombre>` | Borrar una foto con `X-Confirm: delete` |

## Operación

Use una instancia Node.js persistente por instalación. Necesita salida a MQTT/TLS y acceso a Firebase. Cada instalación usa su propio proyecto Firebase y un prefijo MQTT único. En un corte del broker, del proceso Next.js o de Firestore pueden perderse muestras de telemetría. Al volver la conexión, los nuevos mensajes actualizan el estado. El registro de raciones y el control local de la placa siguen el firmware.

Si el panel muestra MQTT conectado y la placa figura fuera de línea, revise en MQTTX que el prefijo coincida y que lleguen mensajes recientes. Si MQTTX tampoco recibe datos, verifique en el monitor serie el Wi-Fi, la hora de la placa, el certificado CA, el usuario del broker y sus permisos. Si Firestore no recibe datos mientras MQTTX sí los ve, compruebe proyecto, ADC y permisos del monolito. [Manual desde cero](manual_software.md).
