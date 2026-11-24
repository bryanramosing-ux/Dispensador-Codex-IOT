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

## OBJETIVO

Ayúdame a obtener tres evidencias consecutivas:

1. Windows detecta el ESP32 y Arduino IDE muestra su COM.
2. Upload de Control.ino termina correctamente en esa placa.
3. MQTTX recibe varias publicaciones reales consecutivas con cm, level y nonce.

## TAREA

1. Empieza en Tools → Port en gris. Dime cómo abrir el Administrador de dispositivos y qué cambio observar en Puertos (COM y LPT) u Otros dispositivos al conectar y desconectar la placa.
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
- Retoma desde la detección USB. Firebase, la creación del broker y la instalación de bibliotecas ya tienen contexto suficiente para esta etapa.

**Primera respuesta que necesito:** dime exactamente qué debo mirar en el Administrador de dispositivos de Windows al conectar el ESP32 principal.
