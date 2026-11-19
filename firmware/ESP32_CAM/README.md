# ESP32-CAM AI-Thinker — Cámara del dispensador

## Responsabilidad

La ESP32-CAM publica su estado y responde con fotogramas JPEG por MQTT/TLS. El panel solicita estos fotogramas a través del monolito. El clasificador externo puede acceder al HTTP local de la cámara.

## Endpoints HTTP para la red local

| Ruta | Respuesta |
|---|---|
| `GET /status` | Estado de cámara, PSRAM, resolución, RSSI y contadores |
| `GET /capture` | Una fotografía JPEG nueva |
| `GET /stream` | Stream MJPEG multipart de duración limitada por petición |

El stream implementado envía un número finito de cuadros por conexión y luego termina; el cliente local puede volver a conectarse. No equivale a un servicio de video ilimitado ni garantiza una tasa de cuadros fija. La captura y el stream comparten el recurso de cámara y deben probarse con un solo cliente inicialmente.

## Hardware

- Módulo ESP32-CAM AI-Thinker con sensor OV2640 y PSRAM habilitada.
- Alimentación estable de 5 V al pin 5V y GND.
- Desacoplo recomendado: 470 µF y 100 nF cerca del módulo.
- No conectar GPIO de la ESP32-CAM al ESP32 DevKit: se comunican por Wi-Fi.
- No usar la cámara 5110V0 del inventario como sustituta sin identificar sensor, interfaz, pinout y tensión.

La cámara puede reiniciarse si la alimentación cae. No desactive el detector brownout: corrija fuente, cable y distribución.

## Programación

1. Usar ESP32-CAM-MB o adaptador USB-TTL con UART a niveles lógicos de 3,3 V.
2. Con USB-TTL: 5V a 5V, GND a GND, TX/RX cruzados a U0R/U0T.
3. GPIO0 a GND solo durante la carga; retirar el puente y reiniciar para ejecución normal.
4. Seleccionar AI Thinker ESP32-CAM, habilitar PSRAM y elegir partición compatible con el tamaño de firmware.
5. Copiar `secrets_ejemplo.h` a `secrets.h` y completar Wi-Fi y MQTT/TLS. Instalar ArduinoJson 7.4.2.
6. Usar DHCP por defecto. Si se usa OpenCV local, reservar una IP o asignarla en `secrets.h`.

## Prueba

Para el panel remoto, compruebe que aparezca en línea y abra la vista previa desde otra red. Para OpenCV local, compruebe `/status`, `/capture` y `/stream` desde el PC de visión. [Manual de software](../../docs/manual_software.md).
