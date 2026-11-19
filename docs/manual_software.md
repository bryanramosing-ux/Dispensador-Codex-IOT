# Manual de software del dispensador IoT

Este manual cubre la instalación desde cero, la conexión con Firebase, el arranque en Visual Studio Code y la puesta en marcha de las placas. Puedes comprobar el backend y Firestore con el ESP32 y la cámara desconectados. Los valores de IP son ejemplos y se sustituyen por los de tu red.

## 1. Instalar los programas y abrir el proyecto

| Programa                                           | Para qué se usa                                        |
| -------------------------------------------------- | ------------------------------------------------------ |
| Git y Visual Studio Code                           | Descargar y trabajar con el repositorio                |
| Node.js 24 LTS, desde 24.15, con npm 11 o superior | Instalar, compilar y arrancar NestJS y Vue             |
| Java 21                                            | Ejecutar los emuladores de Firebase                    |
| Python 3.10+ disponible como `python3`             | Pruebas de contrato e importación del backend anterior |
| Arduino IDE 2, Arduino CLI o PlatformIO            | Compilar y cargar los sketches en las placas           |

La aplicación web con Firebase real solo requiere Git y Node.js para instalarse y arrancar. Usa Java, Python y Arduino según las tareas que vayas a ejecutar. [Git](https://git-scm.com/downloads) · [Node.js](https://nodejs.org/es/download) · [Visual Studio Code](https://code.visualstudio.com/download) · [Java 21](https://adoptium.net/temurin/releases/?version=21) · [Arduino](https://www.arduino.cc/en/software)

En la terminal de VS Code o del sistema:

```bash
git --version
node --version
npm --version
git clone https://github.com/bryanramosing-ux/Dispensador-Codex-IOT.git
cd Dispensador-Codex-IOT
npm ci
code .
```

Si ya tienes el clon, ábrelo en VS Code y ejecuta `npm ci` desde la carpeta que contiene `package.json`. Si `code .` no está disponible, elige **Archivo → Abrir carpeta**.

## 2. Crear y conectar un proyecto Firebase real

1. En Firebase, crea un proyecto dedicado al dispensador. Copia su **ID del proyecto** desde **Configuración del proyecto → General**. El ID puede ser distinto del nombre visible.
2. Abre **Firestore Database → Crear base de datos**. Crea la base `(default)` en modo nativo, edición Standard, con reglas iniciales de producción. Selecciona la región al crearla.
3. En **Configuración del proyecto → Cuentas de servicio**, genera la clave privada de una cuenta de servicio y guarda el archivo JSON fuera del repositorio. Si administras identidades desde Google Cloud IAM, puedes usar una cuenta dedicada con el rol **Usuario de Cloud Datastore** (`roles/datastore.user`). Para fotos en la nube, añade **Usuario de objetos de Storage** (`roles/storage.objectUser`) sobre el bucket elegido.
4. Para administrar reglas e índices, inicia sesión con tu cuenta de Google en Firebase CLI. La sesión de la CLI sirve para desplegar configuración. NestJS se autentica mediante las credenciales ADC indicadas en el paso siguiente. [Consola de Firebase](https://console.firebase.google.com/) · [Credenciales ADC](https://cloud.google.com/docs/authentication/provide-credentials-adc)

En la raíz, crea `.env` una vez. Si ya existe, edítalo conservando tus valores.

**PowerShell**

```powershell
Copy-Item .env.example .env
code .env
```

**Bash en macOS o Linux**

```bash
cp .env.example .env
code .env
```

Genera tres valores diferentes y guárdalos como contraseña de administrador, secreto de sesión y token del DevKit, respectivamente:

```bash
node -e "for (let i = 0; i < 3; i++) console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edita las líneas correspondientes de `.env`. Este ejemplo arranca desde el PC y deja la IP del DevKit en descubrimiento por telemetría:

```dotenv
FIREBASE_PROJECT_ID=id-real-del-proyecto
GOOGLE_APPLICATION_CREDENTIALS="C:/Users/TU_USUARIO/firebase/dispensador-admin.json"
ADMIN_PASSWORD=primera_clave_generada
SESSION_SECRET=segunda_clave_generada
TOKEN_DISPOSITIVO=tercera_clave_generada
FIREBASE_STORAGE_BUCKET=
HOST=0.0.0.0
PORT=8001
PUERTO_DESCUBRIMIENTO=41234
ESP32_URL=
ESP32_CAM_URL=http://192.168.1.51
STORAGE_DIR=.data
COOKIE_SECURE=0
```

En Linux o macOS usa la ruta absoluta de tu equipo, por ejemplo `/Users/tu_usuario/firebase/dispensador-admin.json`. Si el proyecto restringe la creación de claves, otra opción de desarrollo es iniciar sesión con `gcloud auth application-default login` y dejar comentada la línea `GOOGLE_APPLICATION_CREDENTIALS`. Mantén comentadas ambas variables de emulador para usar Firebase real. Verifica que Git ignore tus archivos de configuración local:

```bash
git check-ignore .env firmware/ESP32/Dispensador_ESP32/secrets.h firmware/ESP32_CAM/Camara_ESP32CAM/secrets.h
```

Publica las reglas e índices sobre el ID real del proyecto dedicado. Las reglas cierran el acceso directo de los clientes a la base. NestJS usa Firebase Admin con IAM.

```bash
npx --yes firebase-tools@15.36.0 login
npx --yes firebase-tools@15.36.0 projects:list
npx --yes firebase-tools@15.36.0 deploy --only firestore:rules,firestore:indexes --project TU_ID_DE_PROYECTO
```

Firebase Authentication y el registro de una aplicación web en Firebase son innecesarios para este flujo. La sesión del dashboard se maneja en NestJS con `ADMIN_PASSWORD`.

### Fotos en Cloud Storage

Abre **Storage** en Firebase, crea el bucket del proyecto y copia su nombre exacto. La consola puede solicitar habilitar la facturación para aprovisionar Storage. En `.env`, introduce el nombre con el sufijo que indique la consola, sin el prefijo `gs://`:

```dotenv
FIREBASE_STORAGE_BUCKET=nombre-real-del-bucket.firebasestorage.app
```

Aplica las reglas de Storage desde la raíz y reinicia NestJS:

```bash
npx --yes firebase-tools@15.36.0 deploy --only storage --project TU_ID_DE_PROYECTO
```

Una nueva captura debe aparecer en **Storage → Archivos → gallery** y en **Firestore → photos**. Las fotos que ya se sincronizaron con el bucket vacío conservan sus JPEG en el SQLite de ese equipo. Con el bucket vacío, las nuevas fotos también se alojan localmente.

## 3. Arrancar el dashboard y verificar Firebase

**Modo de uso**, con NestJS sirviendo el dashboard compilado:

```bash
npm run build
npm start
```

Abre **http://localhost:8001** e inicia sesión con `ADMIN_PASSWORD`. Deja abierta la terminal del backend. Detén el proceso con `Ctrl+C`; reinícialo después de cambiar `.env`. Tras cambios en el código, recompila antes de arrancar.

**Modo de desarrollo**, en dos terminales abiertas en la raíz:

```bash
# Terminal 1
npm run dev:backend
```

```bash
# Terminal 2
npm run dev:frontend
```

Abre **http://localhost:5173** en el PC. Vite escucha solo en el equipo de desarrollo y reenvía `/api` al puerto 8001. Si cambias el puerto de NestJS, establece `VITE_BACKEND_URL` en la terminal de Vite y reinícialo. Ejemplo en PowerShell: `$env:VITE_BACKEND_URL = 'http://127.0.0.1:8002'`. En Bash: `export VITE_BACKEND_URL=http://127.0.0.1:8002`. En VS Code, **Terminal → Ejecutar tarea** también ofrece **NestJS (desarrollo)**, **Vue (desarrollo)**, **Compilar monorepositorio** y **Pruebas del backend**.

**Verificación desde el navegador**

1. Abre `http://localhost:8001/api/health`. Debe responder con `"status":"ok"`.
2. En el dashboard, abre **Cámara → Captura automática** y selecciona **Cada 30 s**. El ajuste se guarda aunque la cámara esté desconectada.
3. En la misma sesión del navegador, abre `http://localhost:8001/api/health/sync`. Tras sincronizar, `pending` llega a `0` y `last_synced_at` tiene un valor en milisegundos. Un `pending: 0` antes de generar datos solo indica que la cola está vacía.
4. En **Firestore → Datos**, verifica el documento `settings/dashboard` con `auto_capture_s: 30`. Vuelve a **Desactivada** si solo estabas probando.

## 4. Usar emuladores para practicar sin un proyecto real

Instala Java 21 y verifica `java -version`. Mantén las claves del dashboard de tu `.env` y cambia estas líneas para usar un directorio de datos independiente. Deja comentada `GOOGLE_APPLICATION_CREDENTIALS` mientras uses el emulador.

```dotenv
FIREBASE_PROJECT_ID=demo-dispensador
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
FIREBASE_STORAGE_BUCKET=demo-dispensador.appspot.com
STORAGE_DIR=.data/emulador
```

En una terminal de la raíz:

```bash
npx --yes firebase-tools@15.36.0 emulators:start --only firestore,storage --project demo-dispensador
```

En otra terminal ejecuta `npm run build` y `npm start`. Repite la prueba de **Captura automática** y `/api/health/sync`. Para regresar al proyecto real, detén NestJS, restaura su ID, sus credenciales y su directorio de datos, comenta los hosts de los emuladores y vuelve a iniciar. Cada entorno debe tener su propia cola SQLite.

## 5. Conectar y programar el ESP32 y la ESP32-CAM

1. Conecta el PC y las dos placas a la misma red local. Las placas usan Wi-Fi de 2,4 GHz. Usa `ipconfig` en Windows o `ip -br address` en Linux para buscar la IPv4 del PC. En macOS puedes verla en **Ajustes del Sistema → Wi-Fi → Detalles → TCP/IP**.
2. Crea un `secrets.h` junto a cada sketch copiando la plantilla correspondiente. Conserva los pines, pulsos y lógica del firmware. Mantén desconectada la alimentación de potencia del servo durante la primera carga y la prueba de comunicación. [Guía de conexiones](https://github.com/bryanramosing-ux/Dispensador-Codex-IOT/blob/main/docs/manual_instrucciones_conexiones.md)
3. En el DevKit, completa `WIFI_SSID`, `WIFI_CLAVE` y `TOKEN_DISPOSITIVO` con el valor de `.env`. Para indicar el PC explícitamente usa, por ejemplo, `#define URL_BACKEND "http://192.168.1.50:8001"`, con tu dirección real. Puedes dejarla vacía si el descubrimiento UDP funciona.
4. En la ESP32-CAM, completa `WIFI_SSID` y `WIFI_CLAVE`. Revisa `IP_CAMARA` en su `config.h`: el valor inicial es `192.168.1.51`. Si tu red utiliza otra subred, usa una IP coherente o deja `IP_CAMARA` vacía para DHCP y consulta la dirección que muestra el monitor serie. Pon esa IP como `ESP32_CAM_URL=http://IP_REAL_CAMARA`, sin añadir `/status`, y reinicia NestJS.
5. Permite conexiones al PC desde la red IoT en **TCP 8001**. Para descubrimiento automático también se utiliza **UDP 41234**. NestJS llega a las placas por **HTTP 80**. Si configuras `ESP32_URL` en `.env`, debe coincidir con la IP de origen efectiva del DevKit.

Si Windows bloquea la conexión desde las placas y el equipo ya está en el perfil de red privado, abre PowerShell como administrador. Crea la regla TCP para el backend y la regla UDP si usarás descubrimiento automático. Restringe ambas a la subred local.

```powershell
New-NetFirewallRule -DisplayName 'Dispensador IoT TCP' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8001 -Profile Private -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName 'Dispensador IoT UDP' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 41234 -Profile Private -RemoteAddress LocalSubnet
```

**Copiar las plantillas en PowerShell**

```powershell
Copy-Item firmware/ESP32/Dispensador_ESP32/secrets_ejemplo.h firmware/ESP32/Dispensador_ESP32/secrets.h
Copy-Item firmware/ESP32_CAM/Camara_ESP32CAM/secrets_ejemplo.h firmware/ESP32_CAM/Camara_ESP32CAM/secrets.h
```

En Bash usa los mismos caminos y reemplaza `Copy-Item` por `cp`. Copia cada plantilla solo al configurar la placa por primera vez.

**Arduino IDE.** Abre `firmware/ESP32/Dispensador_ESP32/Dispensador_ESP32.ino`, selecciona **DOIT ESP32 DEVKIT V1** si corresponde a tu placa e instala **ArduinoJson 7.4.2**. Para la cámara, abre `firmware/ESP32_CAM/Camara_ESP32CAM/Camara_ESP32CAM.ino`, selecciona **AI Thinker ESP32-CAM** y la partición **Huge APP**. Selecciona el puerto de cada placa y usa **Verificar** y **Subir**. Consulta el manual de la ESP32-CAM para el modo de carga con tu adaptador.

**Arduino CLI.** Estos comandos instalan el core validado y compilan los dos sketches:

```bash
arduino-cli core update-index --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core install esp32:esp32@3.0.7 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install ArduinoJson@7.4.2
arduino-cli board list
arduino-cli compile --fqbn esp32:esp32:esp32doit-devkit-v1 firmware/ESP32/Dispensador_ESP32
arduino-cli compile --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app firmware/ESP32_CAM/Camara_ESP32CAM
```

Reemplaza `COM_DEVKIT` y `COM_CAMARA` por los puertos detectados, como `COM5` en Windows o `/dev/ttyUSB0` en Linux:

```bash
arduino-cli upload --port COM_DEVKIT --fqbn esp32:esp32:esp32doit-devkit-v1 firmware/ESP32/Dispensador_ESP32
arduino-cli upload --port COM_CAMARA --fqbn esp32:esp32:esp32cam:PartitionScheme=huge_app firmware/ESP32_CAM/Camara_ESP32CAM
arduino-cli monitor --port COM_DEVKIT --config baudrate=115200
```

Si prefieres PlatformIO, abre cada carpeta de placa como proyecto o ejecuta `pio run -d firmware/ESP32` y `pio run -d firmware/ESP32_CAM`. Añade `-t upload --upload-port PUERTO` para cargar la placa correspondiente.

**Comprobación de las placas.** Abre `http://IP_REAL_CAMARA/status` desde el PC y verifica el JSON de la cámara. En el dashboard, pulsa **Cámara → Actualizar conexión** y prueba video y captura. En **Panel**, espera que el ESP32 figure conectado y comprueba que llegue telemetría a Firestore. Utiliza **Control → Dispensar…** únicamente cuando el montaje, la alimentación y la calibración estén verificados. La aceptación del comando confirma que el DevKit lo recibió; la telemetría posterior indica cómo terminó.

## 6. Comandos de comprobación y mantenimiento

Desde la raíz:

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run verify:assets
npx --yes firebase-tools@15.36.0 emulators:exec --only firestore,storage --project demo-dispensador "npm run test:emulator"
```

`npm test` invoca `python3` para las pruebas contra el backend anterior. En Windows usa un entorno con el comando `python3` en el PATH o ejecuta esas pruebas en WSL. Para las pruebas de firmware en un entorno con Make y un compilador C++:

```bash
make -C firmware/ESP32/test_host
python3 -m unittest discover -s hardware/Documentation/wiring/tests -v
```

**Importar datos anteriores.** Detén el backend Python, copia su directorio `backend/storage` y detén NestJS. Configura un `STORAGE_DIR` vacío para la importación inicial. La orden copia historial, ajustes y JPEG, y puede repetirse sobre la misma fuente sin duplicar registros.

```bash
npm run build
npm run import:legacy -- "/ruta/al/respaldo/backend/storage"
npm start
```

**Respaldar datos.** Detén NestJS con `Ctrl+C` y copia el directorio completo configurado en `STORAGE_DIR` a otra ubicación privada. Por defecto es `.data`. El respaldo conserva los JPEG locales y la cola que aún no se haya replicado. Conserva juntos los archivos SQLite y sus archivos auxiliares. Arranca NestJS de nuevo tras terminar.

Con el directorio predeterminado `.data` y NestJS detenido, puedes copiarlo con uno de estos comandos según tu terminal:

```powershell
Copy-Item .data "../respaldo-dispensador-$(Get-Date -Format yyyyMMdd-HHmmss)" -Recurse
```

```bash
cp -a .data "../respaldo-dispensador-$(date +%Y%m%d-%H%M%S)"
```

**Actualizar software.** Con la aplicación detenida y los datos respaldados, ejecuta `git pull --ff-only` en la rama que sigues, luego `npm ci`, `npm run build` y `npm start`. Conserva `.env`, los `secrets.h` y tu directorio de datos. [Repositorio](https://github.com/bryanramosing-ux/Dispensador-Codex-IOT)

## 7. Puertos y diagnóstico rápido

| Dirección o puerto                  | Uso                                         |
| ----------------------------------- | ------------------------------------------- |
| `localhost:8001`                    | Dashboard compilado y API NestJS            |
| `localhost:5173`                    | Dashboard Vite en desarrollo                |
| `41234/UDP`                         | Descubrimiento del backend por el ESP32     |
| `IP_DE_LA_PLACA:80`                 | API HTTP local del DevKit o de la ESP32-CAM |
| `127.0.0.1:8080` y `127.0.0.1:9199` | Emuladores de Firestore y Cloud Storage     |

| Síntoma                                       | Qué revisar primero                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Variables de entorno inválidas`              | Que `.env` esté junto a `package.json`, ID de proyecto correcto, contraseña de al menos 16 caracteres y secreto de sesión de al menos 32.                                                                          |
| `EADDRINUSE`                                  | En PowerShell usa `Get-NetTCPConnection -LocalPort 8001`. En macOS o Linux usa `lsof -iTCP:8001 -sTCP:LISTEN`. Cambia `PORT` en `.env` si necesitas otro puerto y actualiza la URL del navegador y del DevKit.     |
| El navegador recibe 404 en la raíz            | Ejecuta `npm run build` para que NestJS pueda servir `apps/frontend/dist`.                                                                                                                                         |
| Cola que crece o `PERMISSION_DENIED`          | Comprueba proyecto, JSON de credenciales, IAM, conectividad y bucket. Una foto pendiente por permisos de Storage también puede frenar entradas posteriores.                                                        |
| ESP32 desconectado o 401                      | Token idéntico en firmware y backend, IPv4 válida, puerto accesible y coincidencia con `ESP32_URL` si está fijada.                                                                                                 |
| La cámara no responde                         | Comprueba su IPv4 real y `http://IP_CAMARA/status`. Cierra cualquier stream directo abierto hacia la cámara y pulsa **Actualizar conexión**.                                                                       |
| La sesión inicia pero se pierde en HTTP local | Comprueba `COOKIE_SECURE=0` durante la prueba en localhost. Para uso de la interfaz desde otros equipos, configura HTTPS en un proxy de la LAN, `COOKIE_SECURE=1` y el origen HTTPS exacto en `DASHBOARD_ORIGINS`. |
| Resultado del comando desconocido             | Revisa estado e historial antes de volver a confirmar una orden. NestJS conserva el resultado incierto y no reenvía el comando automáticamente.                                                                    |

El diagnóstico de Firebase se hace desde la sesión de administrador en `/api/health/sync`. El archivo de credenciales, el token y la contraseña permanecen en tu equipo. La validación del repositorio usó emuladores y dispositivos simulados, y queda por comprobar la instalación física concreta. [Informe de validación](https://github.com/bryanramosing-ux/Dispensador-Codex-IOT/blob/main/docs/migration/validation.md)
