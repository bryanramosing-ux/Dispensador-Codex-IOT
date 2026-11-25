# Dispensador IoT para mascotas

Abre [DispensadorIoT-Android](DispensadorIoT-Android/) en Android Studio Panda 1. La [guía del proyecto](DispensadorIoT-Android/README.md) explica cómo ejecutar la app en simulación y configurar Firebase y MQTT para las placas reales.

| Trabajo | Ubicación |
|---|---|
| Cargar el ESP32 principal | [Control.ino](DispensadorIoT-Android/firmware/Control/Control.ino) |
| Cargar la ESP32-CAM | [Camara.ino](DispensadorIoT-Android/firmware/Camara/Camara.ino) |
| Configurar Firestore | [Configuración](DispensadorIoT-Android/firebase.json) y [reglas](DispensadorIoT-Android/firestore.rules). Ejecuta los comandos de Firebase desde DispensadorIoT-Android. |
| Preparar la prueba con Marcelo | [Guía para el laboratorio](PROMPT_CLAUDE_ESP32.md) |
| Registrar mediciones | [Plantillas de calibración](hardware/Documentation/calibration/) |
| Consultar la mecánica | [Modelos STL](assets/3d/STL/). El ensamblaje 00 es una referencia del diseño anterior. Comprueba las dimensiones del soporte 06 con tu MG996R antes de imprimir. |

Configura las credenciales de cada placa en su copia local de secrets.h. Para la prueba real, comprueba que llega un mensaje nuevo del ESP32 a MQTTX y verifica la cámara y la dispensación desde la app.
