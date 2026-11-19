# Verificación del dispensador

## Compilación y pruebas unitarias

~~~bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:assets
~~~

GitHub Actions compila ambos firmwares con Arduino-ESP32 2.0.17 y 3.0.7 y ejecuta las pruebas unitarias del controlador. La primera carga de los firmwares y la operación de los sensores, el servo y la cámara se verifican en las placas de la instalación.

## Prueba de la instalación real

1. Completa `.env.local` y ejecuta `pnpm check:connections`. El comando verifica los servicios reales de Authentication y Firestore, y las suscripciones TLS del monolito al broker.
2. Ejecuta `pnpm dev`. Inicia sesión con la cuenta de operador creada en Firebase. Comprueba que puedes abrir el panel y que un usuario sin documento activo en `operators` recibe un acceso denegado.
3. Enciende ambas placas. Observa sus mensajes desde MQTTX. En el panel comprueba el nivel de la tolva y en Firebase Console revisa los documentos `device_status/esp32` y `device_status/camera`.
4. Abre la vista previa de la cámara. Guarda y descarga una foto, y comprueba `photos` y `photo_images` en Firestore. La captura automática arranca desactivada en una instalación nueva.
5. En las condiciones de operación y calibración del manual de armado, solicita **una porción**. Verifica la aceptación del comando, el movimiento y la entrada correspondiente en el historial. La protección de cooldown de la placa se puede comprobar en su telemetría sin disparar otra dosis.
6. Con el panel publicado por HTTPS, abre su URL desde un teléfono con datos móviles. Comprueba la vista de estado y la cámara. [Guía de puesta en marcha](manual_software.md). [Manual de armado](../hardware/Documentation/manual_armado/Manual_de_Armado.md#6-secuencia-de-puesta-en-marcha).
