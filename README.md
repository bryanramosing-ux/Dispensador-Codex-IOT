# Dispensador IoT

Panel web para monitorear la tolva, dispensar porciones, consultar el historial y ver la ESP32-CAM. La interfaz React y la API corren en un monolito Next.js con TypeScript. Firebase Authentication identifica a los operadores, Firestore guarda el estado, los eventos y las fotos, y un broker MQTT con TLS conecta el monolito con las placas a través de Internet.

## Primer arranque

Siga el manual para clonar la rama, preparar VS Code y pnpm, crear el proyecto Firebase, autorizar al primer operador y conectar las placas con MQTTX. [Manual para iniciar desde cero](docs/manual_software.md).

Para un proyecto ya configurado, abra la carpeta raíz y ejecute lo siguiente. El panel abre en [http://localhost:3000](http://localhost:3000).

~~~bash
pnpm install --frozen-lockfile
pnpm check:connections
pnpm dev
~~~

## Documentación

| Documento | Contenido |
|---|---|
| [Arquitectura y protocolo](docs/arquitectura_local.md) | Monolito, MQTT, API y despliegue |
| [Esquema de Firestore](docs/firestore/schema.md) | Colecciones, acceso, índices y datos previos |
| [Pruebas](docs/pruebas.md) | Verificaciones y prueba desde dos redes |
| [Controlador ESP32](firmware/ESP32/README.md) | Firmware, monitor serie y control local |
| [ESP32-CAM](firmware/ESP32_CAM/README.md) | Firmware, captura remota y HTTP local para visión |
| [Hardware y armado](hardware/Documentation/) | Cableado, alimentación, calibración, manual y video |
| [Impresión 3D](assets/3d/) | STL, renders y plan de impresión |
| [Historial de migraciones](docs/migration/) | Material de referencia de las versiones anteriores |

El modo manual por botón BOOT y monitor serie opera localmente. El modo automático de detección de mascotas usa el clasificador local opcional y viene desactivado en el firmware. La captura automática de fotos se configura desde el panel.
