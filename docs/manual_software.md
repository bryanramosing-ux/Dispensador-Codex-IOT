# Puesta en marcha del dispensador IoT en Visual Studio Code

La instalación usa un proyecto Firebase con **Authentication y Firestore**, un **broker MQTT con TLS** accesible por Internet y las dos placas. El monolito necesita la configuración web de Firebase, las credenciales de Firebase Admin y un usuario del broker. Cada placa usa sus propias credenciales MQTT y las de su red Wi-Fi.

## 1. Preparar Visual Studio Code y pnpm

Instala Git, Visual Studio Code, Node.js 24 LTS (24.15 o superior dentro de la versión 24) y pnpm 11.25.0. Si Node incluye Corepack, puedes instalar pnpm con `corepack enable pnpm` y `corepack install --global pnpm@11.25.0`. [Instalación de pnpm](https://pnpm.io/installation).

~~~bash
git clone --branch feat/next-monolito-mqtt-firebase https://github.com/bryanramosing-ux/Dispensador-Codex-IOT.git
cd Dispensador-Codex-IOT
code .
node --version
pnpm --version
pnpm install --frozen-lockfile
~~~

También puedes abrir la carpeta desde **Archivo → Abrir carpeta**. Ejecuta los comandos en **Terminal → Nueva terminal** de VS Code, en la raíz del repositorio. Si ya tienes el repositorio, cámbiate a la rama indicada y ejecuta `git pull --ff-only`.

Crea `.env.local` desde `.env.example`. Usa `cp .env.example .env.local` en macOS/Linux o `Copy-Item .env.example .env.local` en PowerShell. Si tienes una configuración anterior, usa la plantilla actual y traslada los valores de tu proyecto Firebase, tu cuenta de servicio y tu broker.

## 2. Crear y configurar Firebase

1. Crea un proyecto en Firebase Console. En **Firestore Database → Crear base de datos**, selecciona la base `(default)` en modo de producción. Los documentos y las colecciones se crean con las primeras escrituras. [Firebase Console](https://console.firebase.google.com/). [Esquema de Firestore](firestore/schema.md).
2. En **Authentication → Método de acceso**, habilita **Correo electrónico/contraseña**. En **Usuarios**, crea tu cuenta y copia su **UID**. Para el desarrollo, revisa que `localhost` figure en **Dominios autorizados**. Al publicar el panel, agrega también su dominio.
3. En **Configuración del proyecto → General → Tus apps**, registra una app web. Copia `apiKey`, `authDomain`, `projectId` y `appId` a las cuatro variables `NEXT_PUBLIC_FIREBASE_*`. Copia el mismo `projectId` en `FIREBASE_PROJECT_ID`.
4. En **Configuración del proyecto → Cuentas de servicio → Firebase Admin SDK**, genera la clave JSON de la cuenta de servicio para tu equipo. Guarda ese archivo fuera del repositorio y pon su ruta absoluta en `GOOGLE_APPLICATION_CREDENTIALS`. En Windows puedes escribirla así:

   ~~~dotenv
   GOOGLE_APPLICATION_CREDENTIALS="C:/ruta/privada/service-account.json"
   ~~~

   Si el servidor se ejecuta en Google Cloud con identidad de servicio, puede obtener sus credenciales del entorno. La identidad del servidor necesita consultar usuarios de Authentication y leer y escribir en Firestore. Los roles **Firebase Authentication Viewer** y **Cloud Datastore User** cubren esos accesos. Mantén el JSON, `.env.local` y los `secrets.h` fuera de Git. [Credenciales de Firebase Admin](https://firebase.google.com/docs/admin/setup).

Publica las reglas y los índices con una cuenta que pueda desplegar en ese proyecto. Sustituye `TU_PROYECTO` por el ID de Firebase, no por el nombre visible de la consola.

~~~bash
pnpm dlx firebase-tools@15.36.0 login
pnpm dlx firebase-tools@15.36.0 deploy --only firestore --project TU_PROYECTO
~~~

Autoriza el UID que copiaste de **Authentication → Usuarios**. El comando comprueba que la cuenta exista y crea `operators/{uid}` con `active: true`. El correo y la contraseña de esa cuenta son los que usarás en el panel.

~~~bash
pnpm firebase:operator grant UID_DEL_OPERADOR
~~~

Para retirar el permiso de una cuenta, ejecuta `pnpm firebase:operator revoke UID_DEL_OPERADOR`.

## 3. Configurar el broker MQTT y MQTTX

1. Crea un broker administrado, por ejemplo en EMQX Cloud, o usa un broker propio con DNS público y TLS. Obtén el hostname, el puerto TLS (suele ser 8883) y la CA correspondiente. Habilita MQTT 3.1.1, autenticación y paquetes de al menos 512 kB para los fotogramas. [EMQX Cloud](https://www.emqx.com/en/cloud).
2. Crea usuarios distintos para el monolito, el DevKit, la cámara y MQTTX. Asigna los permisos de publicación y suscripción de cada uno siguiendo la tabla. El usuario de MQTTX puede quedar en modo de solo lectura para observar la instalación. [Temas y permisos MQTT](arquitectura_local.md#temas-mqtt-y-acl).
3. Completa `MQTT_URL` con la URL TLS del broker (formato `mqtts://HOST:8883`), `MQTT_USERNAME`, `MQTT_PASSWORD` y `MQTT_SITE_ID` en `.env.local`. Si el broker usa una CA privada, indica la ruta del PEM en `MQTT_CA_FILE`.
4. En MQTTX Desktop, crea una conexión con el host y puerto del broker, el usuario de diagnóstico y **SSL/TLS** activo. Si corresponde, importa el certificado CA. Suscríbete a `dispensador/TU_SITIO/esp32/telemetry`, `dispensador/TU_SITIO/esp32/alert` y `dispensador/TU_SITIO/camera/status`, con el mismo valor de `MQTT_SITE_ID`. [MQTTX Desktop](https://mqttx.app/).

## 4. Comprobar servicios y abrir el panel

~~~bash
pnpm check:connections
pnpm dev
~~~

`pnpm check:connections` debe mostrar **OK** para Firebase Authentication, Firestore y el broker MQTT/TLS. Comprueba acceso y suscripciones de la cuenta de servicio y del monolito. La prueba del usuario final se hace iniciando sesión en el panel. Abre [http://localhost:3000](http://localhost:3000) y usa el correo y la contraseña del operador. Hasta que las placas envíen su primer mensaje, aparecerán sin conexión.

| Si falla | Comprueba |
|---|---|
| `pnpm check:connections` falla en Authentication o Firestore | Los IDs de proyecto coinciden, la ruta del JSON existe y su cuenta de servicio tiene los permisos indicados. Firestore debe estar creado como `(default)`. |
| El login rechaza al operador | Correo/contraseña está habilitado, el usuario existe en ese proyecto y su UID tiene `operators/{uid}.active = true`. |
| Falla MQTT/TLS | Host y puerto, usuario y contraseña, cadena CA, DNS y las ACL de la tabla de temas. Las placas también necesitan que la red permita el puerto del broker y NTP. |
| Falla el historial filtrado con un mensaje de índice | El comando de despliegue de Firestore se ejecutó en ese proyecto y el índice `history` por `tipo` ya terminó de construirse. |

Reinicia `pnpm dev` después de editar `.env.local`. La tarea **Dispensador: desarrollo** de VS Code ejecuta el mismo comando.

## 5. Compilar y cargar el firmware

1. En Arduino IDE, agrega el [índice oficial de placas Arduino-ESP32](https://espressif.github.io/arduino-esp32/package_esp32_index.json) en **Preferencias → URLs adicionales del gestor de placas**. Instala **esp32** de Espressif versión **3.0.7** y **ArduinoJson 7.4.2** en el Gestor de bibliotecas.
2. Para el controlador abre `firmware/ESP32/Dispensador_ESP32/Dispensador_ESP32.ino` y selecciona **DOIT ESP32 DEVKIT V1**. Para la cámara abre `firmware/ESP32_CAM/Camara_ESP32CAM/Camara_ESP32CAM.ino` y selecciona **AI Thinker ESP32-CAM** con partición **Huge APP**.
3. Copia `secrets_ejemplo.h` a `secrets.h` dentro de **cada** sketch. Configura el Wi-Fi de 2,4 GHz, el host MQTT sin `mqtts://`, el puerto, el usuario y la contraseña de esa placa. Usa la misma `MQTT_SITE_ID` del monolito. Deja las direcciones IP locales vacías para DHCP.
4. Pega la CA proporcionada por el broker en `MQTT_CA_PEM`. En C++, deja los caracteres `\n` al final de cada línea del certificado.

   ~~~cpp
   #define MQTT_CA_PEM \
     "-----BEGIN CERTIFICATE-----\n" \
     "CONTENIDO_BASE64_DE_LA_CA\n" \
     "-----END CERTIFICATE-----\n"
   ~~~

5. Carga y verifica cada placa por separado. Abre el monitor serie a **115200 baudios**. En el controlador, `RED` muestra Wi-Fi y MQTT, y `ESTADO` muestra la telemetría. En la ESP32-CAM, busca el mensaje **MQTT cámara conectado**. Confirma los temas en MQTTX y el estado en el panel. [Controlador ESP32](../firmware/ESP32/README.md). [Programación de la ESP32-CAM](../firmware/ESP32_CAM/README.md).

## 6. Montar y verificar el equipo

Consulta las secciones de **componentes, alimentación y conexiones de señales** del manual de armado. Haz la comprobación de tensiones y polaridad antes de conectar los módulos. Usa los GPIO y el divisor de tensión indicados en el manual. [Manual de armado](../hardware/Documentation/manual_armado/Manual_de_Armado.md#2-componentes).

1. Comprueba primero el controlador, la lectura del HC-SR04 y la cámara. Calibra la tolva vacía y llena según el procedimiento del repositorio. En el panel revisa la telemetría, abre la cámara y guarda una foto. Confirma que aparecen documentos en `device_status`, `telemetry`, `photos` y `photo_images`.
2. Con la alimentación apagada, conecta el MG995 a su rama de potencia con tierra común según el esquema. Sigue la prueba inicial del mecanismo y calibra las porciones con el procedimiento de pesaje. [Calibración del dispensador](../hardware/Documentation/calibration/calibracion.md).
3. Cuando el equipo esté calibrado, envía una orden de **una porción** desde el panel. Comprueba el acuse del ESP32 y luego el resultado de la dosis en **Historial**. Si falta el acuse, consulta el historial y el estado físico antes de pedir otra porción.
4. Repite la prueba de acceso desde otra red después de publicar el panel. Un teléfono con datos móviles permite comprobar que el panel abre y recibe telemetría mientras las placas siguen en su Wi-Fi. [Secuencia de verificación](pruebas.md#prueba-de-la-instalación-real).

## 7. Publicar el panel para usarlo desde otra red

Instala el monolito en un servidor o contenedor que mantenga un proceso Node.js activo. Configura la salida hacia Firebase y el broker, y HTTPS en el dominio del panel. Define las variables `NEXT_PUBLIC_*` antes de compilar y las credenciales privadas al iniciar el proceso.

~~~bash
pnpm install --frozen-lockfile
pnpm check:connections
pnpm build
pnpm start --hostname 0.0.0.0
~~~

El dominio HTTPS sirve el panel. Las placas llegan al broker mediante conexiones salientes. [Arquitectura y diagnóstico](arquitectura_local.md).
