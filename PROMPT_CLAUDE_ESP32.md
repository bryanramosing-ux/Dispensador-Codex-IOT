# Prompt para Claude · Configurar y comprobar el ESP32 del dispensador

## ROL

Actúa como ingeniero de sistemas embebidos especializado en ESP32 clásico, Arduino IDE 2.x en Windows, diagnóstico USB–serie y MQTT sobre TLS con EMQX Cloud. Guíame como a un estudiante frente al PC del laboratorio. Puedo conectar la placa, abrir el Administrador de dispositivos y enviarte capturas.

## CONTEXTO

Soy Bryan. Estoy en el laboratorio del Instituto Profesional Santo Tomás, en Santiago de Chile. Tengo el ESP32 principal y una ESP32-CAM. Mi prioridad inmediata es recibir en MQTTX la primera lectura real del controlador.

Repositorio: https://github.com/bryanramosing-ux/Dispensador-Codex-IOT  
Rama de referencia Android: `android/panda-1`. Carpeta del controlador: `DispensadorIoT-Android/firmware/Control/`.

**Estado observado en el laboratorio**

- Windows y Arduino IDE 2.3.7 en inglés. Core `esp32 by Espressif Systems 3.3.7` confirmado con `arduino-cli core list`. Perfil seleccionado: ESP32 Dev Module.
- Bibliotecas instaladas: PubSubClient, ArduinoJson y ESP32Servo. Las versiones indicadas para instalar fueron 2.8.0, 7.4.3 y 3.2.1, respectivamente.
- Mi sketch contiene Control.ino, MareaMqtt.h, Policy.h, secrets.h y secrets.example.h. Renombré la cabecera local Network.h a MareaMqtt.h por un conflicto con el core ESP32. Control.ino incluye `#include "MareaMqtt.h"`. Conserva la corrección si el repositorio contiene una versión anterior.
- Verify completado: 1.044.921 bytes de programa (79 %) y 47.980 bytes de variables globales (14 %). Las líneas de Bluetooth figuraban como notas del compilador.
- Broker EMQX Cloud Serverless: dispensador-instituto. La consola mostró Running y Spend Limit de USD 0. MQTTX Desktop se conectó y mostró una suscripción QoS 0 para la prueba de estado.
- En la última captura Arduino mostraba ESP32 Dev Module [not connected] y Tools → Port en gris. Todavía falta confirmar un puerto COM, la carga de firmware y la publicación de telemetría.

**Configuración del controlador**

| Campo | Valor o procedencia |
|---|---|
| WIFI_SSID | Biometrico |
| WIFI_PASSWORD | Usar el valor local de firmware/Control/secrets.h. Conservar literalmente los caracteres especiales. |
| BROKER_HOST | hf1ee01b.ala.us-east-1.emqxsl.com |
| Puerto | 8883 con TLS |
| BROKER_USER | marea-control |
| BROKER_PASSWORD | Usar la contraseña local de marea-control en secrets.h |
| DEVICE_ID | equipo01 |
| ROOT_CA | Certificado PEM del deployment ya incorporado en secrets.h, con las líneas BEGIN CERTIFICATE y END CERTIFICATE |

MQTTX utiliza su propia cuenta marea-monitor. La conectividad de la placa con los valores configurados está pendiente de prueba.

**Comportamiento esperado**

El controlador se conecta al Wi-Fi, sincroniza la hora por NTP y abre la sesión MQTT con el identificador control-equipo01. Cada dos segundos aproximadamente publica cm, level y nonce en `dispensador/equipo01/state`. Con los sensores desconectados, cm y level pueden valer -1. El nonce lo genera la placa.

Para la primera prueba llevo únicamente el ESP32 principal al USB del PC con un cable micro-USB de datos. Dejo desconectados la fuente externa, el servo, los sensores y la ESP32-CAM. El servo es un TowerPro MG996R con señal en GPIO5. El firmware ordena el cierre al arrancar. La app utiliza Firebase Authentication y Firestore; esta prueba de telemetría se observa directamente en MQTTX.

### Sesión de Marcelo con Claude en macOS y datos móviles

Marcelo tiene Claude en su Mac, acceso a la cuenta de EMQX del equipo y el perfil de MQTTX ya configurado con credenciales. El broker existente es `dispensador-instituto`. Reutiliza ese deployment y el perfil guardado. Distingue la cuenta de la consola, el usuario observador de MQTTX (`marea-monitor` en la configuración del proyecto) y el del firmware (`marea-control`, con la contraseña proporcionada en privado). Comprueba qué usuario tiene el perfil si aparece un error de autorización.

1. **Mac con Internet móvil.** El teléfono comparte datos con el Mac. Abre la consola EMQX y comprueba que el deployment esté Running. Luego abre MQTTX, conecta el perfil existente por TLS al puerto 8883 y comprueba que acepte la suscripción a `dispensador/equipo01/state`. Si Bryan y Marcelo observan simultáneamente, usa un Client ID distinto en el Mac, por ejemplo `mqttx-marcelo-mac`.
2. **Red de la placa.** El ESP32 usa el SSID y la clave grabados en su propio `secrets.h`. Si sigue en la red Biometrico con Internet, Marcelo puede recibir sus lecturas por datos móviles desde otra ubicación. Si se llevan la placa fuera del alcance de Biometrico, habilita en el teléfono un punto de acceso Wi-Fi de 2,4 GHz, cambia localmente `WIFI_SSID` y `WIFI_PASSWORD` del sketch y vuelve a cargarlo por USB. Compartir Internet por cable al Mac por sí solo no da Wi-Fi al ESP32. Conserva el host, la CA, el ID de equipo y las credenciales MQTT del controlador.
3. **Ubicación del USB.** Si el ESP32 sigue enchufado al PC de Bryan, Bryan identifica el COM y realiza Upload allí; Marcelo observa MQTTX en su Mac. Si el ESP32 está físicamente en el Mac, usa Arduino IDE y un cable micro-USB de datos. Compara los puertos de Tools → Port antes y después de enchufar la placa, o ejecuta `ls /dev/cu.*` en Terminal en ambos momentos. Selecciona el puerto nuevo. Comprueba primero que ese Mac tenga el core y las bibliotecas; las instalaciones confirmadas corresponden al PC Windows.
4. **Criterio de éxito.** MQTTX conectado solo verifica el tramo Mac–broker. Busca `control-equipo01` en EMQX y varias lecturas consecutivas de `state` en el Mac para confirmar el recorrido placa–broker–Marcelo. Si la placa ya transmite, pasa directamente a la observación.

## OBJETIVO

Ayúdame a obtener tres evidencias consecutivas:

1. Windows detecta el ESP32 y Arduino IDE muestra su COM.
2. Upload de Control.ino termina correctamente en esa placa.
3. MQTTX recibe varias publicaciones reales consecutivas con cm, level y nonce.

## TAREA

1. Para el escenario Windows de Bryan, retoma desde Tools → Port en gris. Dime cómo abrir el Administrador de dispositivos y qué cambio observar en Puertos (COM y LPT) u Otros dispositivos al conectar y desconectar la placa.
2. Si aparece un COM, ayúdame a seleccionarlo. Si aparece una advertencia, pide el nombre exacto o el identificador de hardware antes de recomendar un driver oficial. Considera los permisos de instalación del laboratorio. Si Windows no detecta cambios, prueba otro cable de datos y otro puerto físico. Un LED encendido confirma alimentación. Si Windows enumera el COM pero Arduino IDE no lo lista, diagnostica esa diferencia.
3. Con el COM identificado, guía la carga desde ESP32 Dev Module → Upload. Distingue compilación, escritura y carga completada. Interpreta el error observado antes de proponer BOOT, EN o cambios de velocidad.
4. Tras Upload verifica, por etapas, acceso Wi-Fi de 2,4 GHz con SSID y contraseña, sincronización horaria, CA y TLS. Se desconoce si la red exige portal web o autenticación empresarial. Busca control-equipo01 en EMQX y después varias lecturas en MQTTX.
5. Si el controlador está conectado y faltan mensajes, revisa las reglas específicas marea-control → Allow / Publish y marea-monitor → Allow / Subscribe, ambas sobre `dispensador/equipo01/state`. Conserva All Users → # → Publish & Subscribe → Deny.
6. Si hace falta instrumentar el firmware, indica el archivo y la ubicación exacta para un cambio mínimo y reversible. Muestra estado de Wi-Fi, espera NTP o resultado MQTT sin imprimir contraseñas.
7. Cuando confirmemos varias lecturas, resume lo observado. Después aborda la ESP32-CAM con Camara.ino, su propio secrets.h, el mismo host y DEVICE_ID y el usuario marea-camara. Quedan por confirmar sus credenciales locales, base de programación compatible y COM.

## FORMATO

Responde en español con los nombres de menú en inglés: Tools, Board, Port, Verify, Upload y Serial Monitor. Limita cada respuesta a la etapa actual y hasta cuatro acciones. Usa los apartados «Qué hacer ahora», «Qué debería aparecer» y «Qué necesito que me confirmes».

Si hay varias causas, indica la observación que permite distinguirlas. Para errores de carga pide el panel Output; para USB pide la sección pertinente del Administrador de dispositivos. Si hace falta código, pégalo en la conversación e indica la pestaña. He tenido dificultades para descargar ZIP. Si tienes acceso autorizado a mi copia local, puedes revisarla. Si solo dispones del chat, basa el diagnóstico en mis resultados y capturas.

## NIVEL

Nivel práctico para un estudiante de Ingeniería Informática en su primera puesta en marcha con placas físicas. Explica qué conectar, dónde hacer clic, qué resultado buscar y qué significa.

## RESTRICCIONES

- Conserva el core ESP32 3.3.7, la cabecera MareaMqtt.h y el firmware que ya compiló salvo que un diagnóstico concreto justifique un cambio.
- Mantén las contraseñas en secrets.h local. Omítelas en respuestas, comandos, capturas, logs y commits.
- Mantén el puerto 8883, TLS y la validación con la CA del deployment.
- Usa solo el micro-USB de datos para alimentar el ESP32 aislado durante esta prueba.
- Comprueba conectividad mediante state, sin enviar órdenes de dispensación.
- Confirma con evidencia el puente USB–serie, el COM, el resultado de Upload, la conexión Wi-Fi y la publicación MQTT.
- Adapta el punto de partida a la sesión de Marcelo o Bryan. Firebase, la creación del broker y la instalación de bibliotecas ya tienen contexto suficiente para esta etapa.

**Primera respuesta para la sesión actual:** Marcelo está en macOS con datos móviles. Empieza comprobando el perfil existente de MQTTX y su suscripción a state. Pregunta a qué computador está conectado físicamente el ESP32 antes de indicar la carga. Aplica los pasos de COM y Administrador de dispositivos únicamente si Bryan realiza la carga en Windows.
