# Marea · dispensador Android

Abre esta carpeta (contiene settings.gradle.kts) en Android Studio. Ejecuta app y pulsa **Probar en simulación**. La guía de montaje, el alta de Firebase y las pruebas MQTTX están en [el manual](docs/MANUAL.md).

| Módulo | Responsabilidad |
|---|---|
| app | Vistas Compose, estado de sesión y PanelModel. El ViewModel recibe eventos del dispositivo y conserva el estado al girar la pantalla. |
| domain | Reading, Entry y los contratos Device y Journal. Kotlin/JVM independiente de Android, Firebase y MQTT. |
| hardware | Adaptadores intercambiables BrokerDevice y Simulator. El primero usa Paho sobre TLS. |
| data | Accounts para Firebase Authentication. CloudJournal y DemoJournal implementan el repositorio Journal con Firestore o almacenamiento local. |
| firmware | Dos sketches independientes. Control mide, valida y acciona. Camara atiende capturas. |

Flujo de una orden: vista → PanelModel → registro pendiente → adaptador Device → broker → ESP32 → ACK → actualización del historial. La app pide confirmación humana y muestra resultado separado de la entrega MQTT. Un ACK de éxito significa que el firmware ejecutó el ciclo del servo. No hay balanza que confirme gramos dispensados.

Proyecto Android separado de NestJS/Vue. La base original usa HTTP y UDP. Los sketches anteriores requieren su backend y se sustituyen en las placas cuando se carga esta versión. El simulador funciona con el teléfono sin broker ni configuración de Firebase. El historial de simulación es local y mantiene los últimos 100 pedidos; el equipo real consulta los últimos 100 pedidos del usuario en Firestore.

Verificación reproducible de política en PC:
```sh
g++ -std=c++17 tests/policy.cpp -o policy && ./policy
```

Compilar Android: JDK 17, SDK 35 y acceso a Google Maven, Maven Central y Gradle. Ejecutar `./gradlew :app:assembleDebug` o `.\gradlew.bat :app:assembleDebug` en Windows. Resultado esperado: `app/build/outputs/apk/debug/app-debug.apk`.

Procedencia del wrapper: Gradle v8.9.0, licencia Apache 2.0. Referencia original: https://github.com/bryanramosing-ux/Dispensador-Codex-IOT

## Primera sesión en casa

1. Clona el repositorio con `git clone https://github.com/bryanramosing-ux/Dispensador-Codex-IOT.git`. En Android Studio abre la subcarpeta `DispensadorIoT-Android`, sincroniza Gradle y ejecuta el módulo app.
2. Entra a **Probar en simulación**, confirma una porción y revisa Historial. El nivel esperado pasa de 78 % a 74 %. Puedes hacer esta prueba sin placas ni cuentas externas.
3. Para usar servicios reales, sigue el [manual paso a paso](docs/MANUAL.md) o [descarga el PDF](docs/Manual-Dispensador-IoT.pdf). Registra la app Android con el paquete `cl.marea.app`. Para MQTT usa el mismo broker e ID en la app y en ambas placas, con credenciales propias para cada cliente.
4. En Arduino IDE abre `firmware/Control/Control.ino` para el DevKit y `firmware/Camara/Camara.ino` para la ESP32-CAM. Usa los sketches de esta carpeta para la app móvil. Copia cada secrets.example.h como secrets.h en su respectiva carpeta. El primer objetivo es recibir state del controlador y luego un JPEG de la cámara, antes de montar el servo.
5. Para colaborar en una rama propia, desde el repositorio ejecuta `git switch -c trabajo-marcelo`. El proyecto excluye secrets.h, google-services.json y local.properties de Git.

Se ejecutó la prueba de política del firmware en PC. La compilación completa de Android, la de ambos sketches y las pruebas con placas físicas siguen pendientes.
