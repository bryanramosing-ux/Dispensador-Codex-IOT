# Iniciar el dispensador IoT desde cero en Visual Studio Code

## 1. Preparar el equipo

Instale Git, Visual Studio Code, Node.js 24 LTS (24.15 o superior dentro de la versión 24) y pnpm 11.25.0. Si su instalación de Node incluye Corepack, ejecute `corepack enable pnpm` y `corepack install --global pnpm@11.25.0`. También puede usar el instalador oficial de pnpm. [Instalación de pnpm](https://pnpm.io/installation).

Abra una terminal y ejecute:

~~~bash
git clone --branch feat/next-monolito-mqtt-firebase https://github.com/bryanramosing-ux/Dispensador-Codex-IOT.git
cd Dispensador-Codex-IOT
code .
node --version
pnpm --version
pnpm install --frozen-lockfile
~~~

Si su sistema no tiene el comando `code`, en Visual Studio Code seleccione **Archivo → Abrir carpeta**. Desde aquí ejecute los comandos en **Terminal → Nueva terminal**, en la carpeta raíz.

Cree el archivo local de configuración. Use `cp .env.example .env.local` en macOS/Linux o `Copy-Item .env.example .env.local` en PowerShell. Mantenga `.env.local`, los certificados privados, las claves JSON y los archivos `secrets.h` fuera de Git.

## 2. Crear y configurar Firebase

1. Cree o seleccione un proyecto en Firebase Console. En **Configuración del proyecto → Tus apps**, registre una aplicación web. Copie `apiKey`, `authDomain`, `projectId` y `appId` a las variables `NEXT_PUBLIC_FIREBASE_*` correspondientes. Use el mismo ID en `FIREBASE_PROJECT_ID`. [Firebase Console](https://console.firebase.google.com/).
2. En **Authentication → Método de acceso**, active **Correo electrónico/contraseña**. En **Usuarios**, agregue la cuenta del operador y copie su UID. En **Dominios autorizados**, agregue su dominio HTTPS para producción y `localhost` si la configuración de su proyecto lo requiere para las pruebas.
3. En **Firestore Database**, cree la base predeterminada `(default)` en modo de producción. Las colecciones se crean con las primeras escrituras. [Esquema de las colecciones](firestore/schema.md).
4. Si usará la galería o la captura automática, active **Storage**, copie el nombre exacto del bucket sin `gs://` a `FIREBASE_STORAGE_BUCKET` y compruebe los requisitos de facturación del proyecto. Puede probar la vista previa con MQTT aunque el bucket esté vacío en la configuración.
5. Configure las credenciales del servidor mediante Application Default Credentials (ADC). En desarrollo puede usar una cuenta de servicio y establecer `GOOGLE_APPLICATION_CREDENTIALS` con la ruta absoluta a su archivo JSON externo al repositorio. En un entorno gestionado use su identidad de servicio. Dicha identidad necesita acceso a resultados de Firebase Auth, lectura y escritura en Firestore y, si usa fotos, permisos sobre los objetos del bucket. [Firebase Admin SDK y ADC](https://firebase.google.com/docs/admin/setup).

Publique las reglas y los índices en el proyecto elegido. Use una cuenta con permisos de despliegue y sustituya `ID_DE_TU_PROYECTO` en los comandos.

~~~bash
pnpm dlx firebase-tools@15.36.0 login
pnpm dlx firebase-tools@15.36.0 deploy --only firestore --project ID_DE_TU_PROYECTO
~~~

Si habilitó Storage, ejecute también:

~~~bash
pnpm dlx firebase-tools@15.36.0 deploy --only storage --project ID_DE_TU_PROYECTO
~~~

Conceda acceso al operador con su UID de Firebase Authentication. El comando valida que exista la cuenta y crea `operators/{uid}` con `active: true`. También puede crear ese documento con un booleano `active` desde Firestore Console.

~~~bash
pnpm firebase:operator grant UID_DEL_OPERADOR
~~~

Para retirar el permiso, ejecute `pnpm firebase:operator revoke UID_DEL_OPERADOR`. El cambio se aplica en la siguiente solicitud a la API.

## 3. Ejecutar Next.js

~~~bash
pnpm dev
~~~

Abra [http://localhost:3000](http://localhost:3000) e inicie sesión. El panel puede abrirse desde **Terminal → Ejecutar tarea → Dispensador: desarrollo**. Si aún no cargó las placas, el controlador y la cámara figuran sin conexión. Reinicie `pnpm dev` tras editar `.env.local`.

## 4. Configurar el broker MQTT y MQTTX

1. Cree un broker MQTT con TLS accesible por Internet, por ejemplo un despliegue administrado de EMQX. Obtenga el nombre DNS, el puerto MQTT TLS (normalmente 8883) y el certificado CA de la cadena. Habilite MQTT 3.1.1, desactive las conexiones anónimas y permita mensajes de al menos 512 kB para la cámara.
2. Cree usuarios distintos para el monolito, el controlador, la cámara y MQTTX. Configure permisos de publicación y suscripción por tema. Para MQTTX puede usar un usuario de solo lectura. [Temas y permisos MQTT](arquitectura_local.md#temas-mqtt-y-acl).
3. En `.env.local`, defina `MQTT_URL=mqtts://TU_BROKER:8883`, `MQTT_USERNAME`, `MQTT_PASSWORD` y `MQTT_SITE_ID`. Use un identificador alfanumérico con guiones o guiones bajos, de hasta 48 caracteres. Si usa una CA privada, indique el archivo PEM en `MQTT_CA_FILE`. Reinicie Next.js.
4. Instale MQTTX Desktop. Cree una conexión MQTT 3.1.1 con el host, puerto y usuario de diagnóstico, active **SSL/TLS** y valide el certificado del broker. Si la CA es privada, importe el certificado CA en la conexión. [MQTTX Desktop](https://mqttx.app/).
5. En MQTTX, suscríbase a `dispensador/TU_SITIO/esp32/telemetry`, `dispensador/TU_SITIO/esp32/alert` y `dispensador/TU_SITIO/camera/status`. Sustituya `TU_SITIO` por `MQTT_SITE_ID`. Los mensajes aparecerán al iniciar las placas.

## 5. Compilar y cargar el firmware

Abra cada sketch en Arduino IDE o su proyecto PlatformIO en VS Code. Para Arduino IDE use Arduino-ESP32 3.0.7 y ArduinoJson 7.4.2 en ambas placas. Seleccione **DOIT ESP32 DEVKIT V1** para el controlador y **AI Thinker ESP32-CAM** con partición **Huge APP** para la cámara. Los archivos de red son independientes.

1. Copie cada `secrets_ejemplo.h` a `secrets.h` dentro de la carpeta de su sketch. Complete Wi-Fi 2,4 GHz, host MQTT sin esquema, puerto, usuario y contraseña de la placa. Use el mismo `MQTT_SITE_ID` que Next.js y use DHCP para despliegues en distintas redes.
2. Pegue el certificado raíz del broker en `MQTT_CA_PEM`. Cada línea del ejemplo siguiente termina con los dos caracteres `\n` en el archivo C++. La placa necesita Internet, resolución DNS y acceso a NTP para validar TLS y rechazar órdenes vencidas.

~~~cpp
#define MQTT_CA_PEM \
  "-----BEGIN CERTIFICATE-----\n" \
  "CONTENIDO_BASE64_DE_LA_CA\n" \
  "-----END CERTIFICATE-----\n"
~~~

3. Cargue los sketches y abra el monitor serie a 115200 baudios. Para el controlador, `RED` muestra Wi-Fi y MQTT, y `ESTADO` muestra la telemetría. Compruebe el estado de ambas placas en el panel y los mensajes en MQTTX.
4. Para una verificación remota real, conecte las placas a Wi-Fi con Internet y abra el panel publicado desde un móvil usando datos móviles. Siga el procedimiento de operación y calibración al probar el actuador. [Prueba desde dos redes](pruebas.md). [Manuales de hardware](../hardware/Documentation/).

## 6. Probar el software sin Firebase real

Instale Java 21 para el emulador Firestore. Inicie los emuladores en una terminal y manténgala abierta.

~~~bash
pnpm dlx firebase-tools@15.36.0 emulators:start --only auth,firestore,storage --project demo-dispensador
~~~

En `.env.local` configure estos valores para el entorno local. El broker puede quedar vacío si solo quiere probar el login.

~~~dotenv
FIREBASE_PROJECT_ID=demo-dispensador
FIREBASE_STORAGE_BUCKET=demo-dispensador.appspot.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-dispensador
NEXT_PUBLIC_FIREBASE_API_KEY=demo-local
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-dispensador.firebaseapp.com
NEXT_PUBLIC_FIREBASE_APP_ID=demo-local
NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
~~~

En [la interfaz local de Firebase](http://127.0.0.1:4000/auth), cree un usuario de prueba, copie su UID y ejecute `pnpm firebase:operator grant UID_DEL_OPERADOR`. Luego ejecute `pnpm dev` e ingrese con esa cuenta. Para la integración automatizada, consulte [Pruebas](pruebas.md).

## 7. Publicar el panel para usarlo desde otra red

Prepare un servidor o contenedor con un proceso Node.js persistente y salida hacia el broker MQTT y Firebase. Use las credenciales de producción y quite las variables de emulación. Establezca las variables `NEXT_PUBLIC_*` antes de compilar y las de servidor al iniciar. Configure HTTPS con el proxy de su plataforma y mantenga la instancia en ejecución para recibir telemetría y realizar la captura automática.

~~~bash
pnpm install --frozen-lockfile
pnpm build
pnpm start --hostname 0.0.0.0
~~~

Abra la URL HTTPS desde el teléfono o el computador. Las placas se conectan al broker mediante conexiones salientes. Para diagnosticar un fallo, revise por separado la conexión del panel a Firebase, la conexión del monolito al broker y los mensajes de cada placa. [Arquitectura y diagnóstico](arquitectura_local.md).
