# Registro de validación

Fecha de ejecución 18 de noviembre de 2026. Entorno Linux con Node.js 24.22.1, npm 11.9.0, Python 3.12.14 y Java 21. El commit original fue comprobado por separado. [Auditoría e inventario](source-audit.md).

## Automatizadas y simuladas

| Comando ejecutado | Resultado |
| --- | --- |
| `npm ci` | Correcto. Instalación limpia desde el lockfile. npm mostró avisos de paquetes transitivos obsoletos. |
| `npm run typecheck` | Correcto en NestJS y Vue. |
| `npm run lint` | ESLint correcto. |
| `npm run build` | TypeScript/NestJS y Vue/Vite correctos. Vite emitió HTML, `app.js` y `styles.css`. |
| `npm test` | 16/16 Jest. Contrato diferencial con Python, seguridad, SSE, UDP, MJPEG, reinicios, idempotencia e importación. |
| `firebase emulators:exec --only firestore,storage --project demo-dispensador 'npm run test:emulator'` | 3/3. Escrituras y paginación en Firestore, rechazo gRPC simulado con persistencia y réplica posterior, acuse perdido inyectado, reanudación tras reinicio, verificación de bytes y borrado en Storage, lectura directa anónima bloqueada. Firestore 1.22.0 y Firebase CLI 15.36.0. |
| Chromium + Playwright, contra el build de NestJS/Vue con dispositivos simulados | Correcto. Carga de HTML/CSS/JS, inicio y cierre de sesión, actualización de nivel por SSE, fotograma, captura, galería y visor, dispensación confirmada, historial y viewport de 390 px. |
| `npm run import:legacy -- /ruta/de/prueba/backend/storage`, repetido | Correcto. Tres registros (historial, ajuste y JPEG), cero nuevos al repetir. Se verificaron ID, bytes y longitud de cola en SQLite. |
| `python3 -m unittest discover -s scripts/legacy/backend/tests -v` | 24/24 en el backend Python preservado, además de la ejecución previa en el clon original. |
| `make -C firmware/ESP32/test_host` | Correcto. Controlador, dosificador en API 2.x/3.x y NVS en host. |
| `make -C firmware/ESP32/test_host sintaxis ARDUINOJSON=/ruta/ArduinoJson/src` | Correcto. Stubs de Arduino 2.x/3.x y ArduinoJson 7.4.2 para DevKit. |
| `arduino-cli compile` con `esp32:esp32:esp32doit-devkit-v1` y `esp32:esp32:esp32cam:PartitionScheme=huge_app` | Correcto en ambos núcleos. 3.0.7: DevKit 86 % de flash y cámara 32 %. 2.0.17: DevKit 75 % y cámara 26 %. Se recuperó un fallo de instalación temporal por espacio tras liberar el núcleo anterior. |
| `python3 -m unittest discover -s hardware/Documentation/wiring/tests -v` | 6/6 pruebas del perfil eléctrico. |
| `python3 scripts/verify-mechanics.py` | Correcto. 45 validaciones geométricas y plan de impresión sin laminador, en una copia temporal. |
| `python3 -m unittest discover -s hardware/OpenCV/tests -v` | 31 correctas, 1 separada para el modelo real. Se descargaron MobileNetV2 e imágenes a una copia temporal y `DISPENSADOR_IMAGENES_PRUEBA=imagenes_prueba python3 -m unittest tests.test_modelo_real -v` pasó con 25 imágenes. |
| `npm run verify:assets` | 109 archivos iguales al commit original por SHA-256. Incluye ambos firmwares y 23 STL. El origen contiene 0 OBJ. |
| `npm audit --audit-level=moderate` | 0 vulnerabilidades en el árbol npm auditado. |
| `gitleaks git --staged --redact` | Sin hallazgos en el contenido preparado para el commit. |
| `actionlint .github/workflows/ci.yml` | Correcto. El workflow está preparado para ejecución cuando se publique el repositorio. |

La prueba de Storage requiere que Jest ejecute sus módulos VM con la opción correspondiente de Node, incluida en `npm run test:emulator`. Los emuladores locales y los dispositivos simulados cubren el protocolo y la sincronización. La prueba de recuperación inyecta el acuse perdido después de un commit real en el emulador. Otra prueba devuelve un rechazo gRPC desde un servidor local y verifica la recuperación contra Firestore emulado. El SDK registró un aviso de búsqueda de credenciales del entorno durante la ejecución con emuladores; las tres pruebas pasaron.

## Pendientes verificables

- [ ] Cargar los dos binarios en las placas y comprobar Wi‑Fi, UDP, telemetría autenticada y reconexión con la IP del PC y el firewall definitivos.
- [ ] Probar cámaras con uno y dos espectadores reales, comprobar cortes por lote y capturas mientras haya video.
- [ ] Medir riel de alimentación, verificar divisores de ambos HC-SR04, calibrar nivel y dosis y medir el MG995 bajo carga siguiendo el manual de montaje. Confirmar los bloqueos del firmware antes del uso con alimento.
- [ ] Conectar al proyecto Firebase de producción, validar IAM, reglas e índices desplegados y efectuar un corte de Internet real con la instalación final.
- [ ] Ejecutar GitHub Actions tras publicar la rama y revisar sus resultados. La ejecución de QEMU queda disponible mediante el script preservado de firmware.
