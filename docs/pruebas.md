# Pruebas del monolito y del firmware

## Verificar TypeScript, React y la API

~~~bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:assets
~~~

Con Java 21 y OpenSSL instalados, ejecute la integración. Inicia el monolito compilado, autentica usuarios en Firebase emulado, transmite mensajes a través de un broker MQTT/TLS temporal y verifica operaciones y permisos en la API.

~~~bash
pnpm dlx firebase-tools@15.36.0 emulators:exec --only auth,firestore,storage --project demo-dispensador 'pnpm test:integration'
~~~

La integración comprueba autorización de operador, reglas de Firestore, telemetría reciente, comandos idempotentes, ausencia de reenvío con resultado desconocido, paginación, fotogramas, guardado, borrado y captura automática.

## Firmware

~~~bash
make -C firmware/ESP32/test_host
arduino-cli lib install ArduinoJson@7.4.2
arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 firmware/ESP32/Dispensador_ESP32
arduino-cli compile --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app firmware/ESP32_CAM/Camara_ESP32CAM
~~~

El flujo de CI compila ambas placas con Arduino-ESP32 2.0.17 y 3.0.7. La primera carga y los ensayos con servo, sensores y cámaras físicas requieren la instalación del usuario. [Guía de firmware y conexión](manual_software.md#5-compilar-y-cargar-el-firmware).

## Verificación con placas y redes distintas

1. Conecte las placas a Wi-Fi de 2,4 GHz con Internet. En MQTTX, compruebe que llegan datos y compare el prefijo con `MQTT_SITE_ID`.
2. Desde un teléfono por datos móviles, abra el panel HTTPS e inicie sesión como operador. Revise estado, tolva e historial.
3. Desde el panel, compruebe la vista previa de la cámara y, si habilitó Storage, guarde y descargue una foto. Desactive luego la captura automática si la activó para la prueba.
4. En las condiciones de prueba del dispensador descritas en la documentación de hardware, solicite una porción y compare el acuse con el registro de la dosis. Compruebe que una segunda orden durante el cooldown se rechaza.
5. Interrumpa el enlace MQTT y compruebe que el panel indica la pérdida de conexión y que el botón BOOT sigue disponible bajo las reglas locales del controlador. Restablezca la conexión y compruebe el siguiente latido.

Para la calibración, la alimentación y las pruebas bajo carga, consulte la documentación existente. [Pruebas de calibración](../hardware/Documentation/calibration/calibracion.md).
