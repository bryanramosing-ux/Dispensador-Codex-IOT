# Marea | Manual del dispensador IoT

**Armado, configuración y prueba de la aplicación Android con hardware real**

## Antes de empezar

El objetivo de la primera sesión es recibir una lectura del ESP32 en el teléfono alimentando el controlador desde el banco. El movimiento del servo queda para después de validar esa lectura y medir la alimentación.

| Ten a mano | Para qué se utiliza |
|---|---|
| PC con Android Studio y Arduino IDE, cable micro-USB de datos y base USB de la cámara | Compilar la app y cargar cada placa por separado. |
| Teléfono Android 8 o posterior, o emulador API 26+ | Ejecutar la app. Una conexión a Internet permite probar Firebase y el broker. |
| ESP32 principal, kit ESP32-CAM MCI10660, 2 HC-SR04 y Tower Pro MG996R | Control, imágenes, distancia al plato, nivel de tolva y apertura del disco. |
| Protoboard, puentes, 2 resistencias de 1 kΩ y 2 de 2 kΩ | Señales y un divisor independiente por sensor. |
| Multímetro, bornes de distribución y cableado apto para la corriente del servo | Verificar polaridad, continuidad y caída de tensión. |
| Fuente regulada de 5 V o MW2122A con convertidor reductor dimensionado | Alimentar el circuito sin USB durante el funcionamiento. |

**Orden de trabajo.** 2 Android → 3 Firebase → 4 broker → 5 MQTTX → 6 programación → 7 fuente → 8 conexiones → 9 sensores → 10 servo y cámara → 11 prueba integral → 12 diagnóstico.

**Antes de mover un cable.** Anota el modelo completo del DevKit, identifica físicamente el pin de entrada de 5 V y comprueba D5 en su pinout. Anota también la corriente nominal de tu fuente y la del regulador. El código “XX5S69” por sí solo es insuficiente para autorizar una conexión por posición física. Trabaja con la salida de la fuente apagada cada vez que cambies el cableado.

## Abrir Android Studio y probar sin componentes

1. Descomprime el ZIP. En Android Studio Ladybug 2024.2.1 o posterior, selecciona **Open** y abre la carpeta que contiene `settings.gradle.kts`. En **SDK Manager** instala Android SDK Platform 35. Usa un JDK 17 disponible para Gradle y su toolchain.
2. Espera a que termine **Sync Project with Gradle Files**. El primer inicio descarga Gradle y las dependencias. En Windows también puedes ejecutar `.\gradlew.bat :app:assembleDebug` desde la terminal de esa carpeta.
3. En **Device Manager** crea un emulador con API 26 o superior, o conecta un teléfono con depuración USB habilitada. Selecciona **app** y pulsa **Run**.
4. Pulsa **Probar en simulación**. La tolva parte en 78 %, el sensor del plato marca 24 cm. Pide una porción y confirma. Debe aparecer 74 % y un ciclo completado en Historial. Un segundo pedido inmediato debe quedar rechazado. Espera diez segundos antes de volver a probar.
5. Gira el teléfono y revisa el historial. Sal por Ajustes y vuelve a entrar en simulación. El historial se conserva en ese teléfono; las lecturas y la cuota del equipo virtual se reinician por sesión. En este modo la cámara indica que requiere equipo físico.

**Si falla el Sync.** Confirma que abriste la carpeta completa, que Gradle puede acceder a services.gradle.org, Google Maven y Maven Central, y que hay JDK 17 y plataforma 35 instalados. El modo simulación se compila sin google-services.json.

**Archivos que vas a usar.** La carpeta app contiene la interfaz y el ViewModel. domain define los contratos; hardware implementa MQTT y el simulador; data contiene Authentication y los repositorios del historial. Los sketches están en firmware/. Para este recorrido no hace falta iniciar el backend NestJS del proyecto web anterior.

**Si usas tu teléfono.** Activa Opciones de desarrollador y Depuración USB, conéctalo al PC y acepta la autorización de depuración en el teléfono. Elige ese dispositivo en la barra superior antes de pulsar Run. El cable del teléfono es independiente del cable de programación del ESP32.

## Configurar Firebase y comprobar el usuario

1. En Firebase Console crea preferentemente un proyecto exclusivo para esta app. En **Configuración del proyecto → Tus apps → Android** registra exactamente `cl.marea.app`. Descarga `google-services.json` y cópialo a `app/google-services.json`. Sincroniza, recompila y reinstala.
2. En **Authentication → Sign-in method** habilita **Correo electrónico/contraseña**. En **Firestore Database** crea la base predeterminada y elige una región. En **Reglas**, publica el contenido de `firestore.rules` para el proyecto dedicado. Si compartes el proyecto con el sistema anterior, integra el bloque específico y conserva las reglas existentes.
3. Pulsa **Crear cuenta** con tu correo y contraseña. Para regresar usa **Ingresar**. Cada cuenta guarda pedidos en `users/{uid}/feedings/{id}`. Los permisos MQTT se configuran por separado en el broker.
4. Desde la app, un pedido se registra antes de publicarse. Si se interrumpe el proceso, “Pendiente” o “Sin confirmación” exige comprobar físicamente el equipo antes de repetirlo. Firestore guarda historial; la telemetría y los JPEG circulan por MQTT. **Guardar fotografía** exporta el último JPEG donde elijas en Android.

**Comprobación con la placa apagada.** Desde la app pulsa Crear cuenta. En Firebase Console abre Authentication → Usuarios y busca el correo registrado. Copia el UID para identificar después su historial. Es normal que todavía no veas documentos en Firestore.

**Qué guardarás en Firestore.** Usa la base Standard predeterminada `(default)`. Cada pedido usa su identificador como nombre de documento. El campo time es un entero en milisegundos desde la época Unix, portions es un entero de 1 a 3 y result es el estado. La regla del ZIP permite al propietario leer y crear sus pedidos y actualizar el resultado. No necesitas poblar la colección a mano.

**Comprobación del archivo Android.** Cambia la vista del explorador de Android Studio a Project. Abre app/ y verifica que google-services.json está al mismo nivel que build.gradle.kts y conserva su nombre exacto. Usa el JSON de registro de la app Android. Las claves privadas de cuentas de servicio pertenecen al servidor y nunca se empaquetan en la app.

[Consola Firebase](https://console.firebase.google.com/) · [Configuración Android](https://firebase.google.com/docs/android/setup) · [Correo y contraseña](https://firebase.google.com/docs/auth/android/password-auth) · [Cloud Firestore](https://firebase.google.com/docs/firestore/quickstart)

## Preparar el broker privado y los permisos

El broker entrega mensajes entre la app y las placas. MQTTX es el cliente de supervisión en el computador. Una vez configurado el sistema, MQTTX puede estar cerrado mientras el teléfono opera el dispensador.

1. En el panel de tu proveedor crea o selecciona una instancia MQTT privada. Por ejemplo, HiveMQ Cloud documenta cómo crear el servicio y configurar el acceso de clientes. Selecciona un servicio que permita restricciones por tópico y verifica las condiciones del plan antes de activarlo.
2. En los datos de conexión copia el **hostname DNS de MQTT sobre TLS**. Comprueba que el puerto es **8883**, que el servicio acepta MQTT 3.1.1 y que admite mensajes binarios de al menos 64 KiB. La app y los sketches del ZIP llevan 8883 en el código.
3. En el control de acceso crea un usuario por cliente y asigna las acciones de la tabla. Cada tópico completo empieza por **dispensador/equipo01/**. Escribe el prefijo y el sufijo en cada permiso, respetando minúsculas. Los nombres de usuario son libres; el ID de equipo debe coincidir en los tres dispositivos.
4. Obtén del proveedor la CA raíz para verificar el certificado del broker. Conserva su contenido PEM para los dos sketches. El broker debe presentar un certificado válido para su hostname y de confianza para Android.

| Cliente | Puede publicar | Puede suscribirse |
|---|---|---|
| Android | cmd, photo | state, ack, jpeg |
| ESP32 control | state, ack, camera/request | cmd, photo |
| ESP32-CAM | jpeg | camera/request |
| MQTTX observador | Ninguno | state, ack y, si corresponde, jpeg |


**Cuenta de observación.** Para seguir todo el trayecto puedes concederle lectura adicional sobre cmd, photo y camera/request del mismo equipo. Mantén la publicación deshabilitada salvo durante la prueba manual autorizada de la última página.

[Ejemplo de aprovisionamiento de un broker privado](https://docs.hivemq.com/hivemq-cloud/quick-start-guide.html)

## Conectar MQTTX y reconocer los mensajes

1. Instala **MQTTX Desktop** en el PC. Pulsa **New Connection** o **+**. En Name escribe “Marea laboratorio” y en Client ID usa un identificador propio, por ejemplo observador-bryan.
2. Selecciona mqtts/TLS, introduce el host del proveedor, puerto 8883, usuario y contraseña del observador. Selecciona MQTT 3.1.1 y sesión limpia. Mantén activa la validación del certificado del servidor y pulsa **Connect**.
3. Añade suscripciones individuales a los tópicos que permita tu cuenta, por ejemplo `dispensador/equipo01/state` y `dispensador/equipo01/ack`. El filtro `dispensador/equipo01/#` solo procede si las ACL admiten ese filtro. Con las placas apagadas puedes conectar correctamente y no recibir mensajes.
4. En la app entra con tu cuenta Firebase, abre **Ajustes**, escribe el host sin protocolo ni puerto, el ID equipo01 y las credenciales MQTT del móvil. Pulsa **Conectar equipo**. La primera lectura habilita el indicador de telemetría.

| Sufijo | Qué debes poder reconocer |
|---|---|
| state | JSON del controlador. level expresa porcentaje de llenado estimado, cm expresa distancia frente al plato y nonce es una clave temporal que devuelve la app con el pedido. |
| cmd → ack | La app publica id, portions y nonce. El ESP32 devuelve el mismo id y el booleano ok. Una orden por ciclo de prueba. |
| photo → camera/request | La app solicita capture o live. El controlador reenvía la petición a la cámara. |
| jpeg | Datos binarios JPEG enviados por la cámara. La app decodifica la imagen; mostrar el contenido como texto en MQTTX produce caracteres ilegibles. |

Usa QoS 0 y Retain desactivado al publicar mensajes manuales de prueba. Ante pérdida de conexión, vuelve a conectar desde Ajustes y espera telemetría reciente antes de operar.

[Guía oficial de MQTTX Desktop](https://mqttx.app/docs/get-started)

## Configurar Arduino IDE y cargar los sketches

En Arduino IDE abre **Preferencias → URLs adicionales del gestor de tarjetas**. Añade el [índice estable de Espressif](https://espressif.github.io/arduino-esp32/package_esp32_index.json). Después abre **Gestor de tarjetas** y **Gestor de bibliotecas** para instalar lo indicado a continuación.

1. En el gestor de placas de Arduino IDE instala **esp32 by Espressif Systems**, serie 3.x. En el gestor de bibliotecas instala **PubSubClient 2.8**, **ArduinoJson 7.x** y una versión de **ESP32Servo compatible con el core ESP32 3.x**.
2. En cada carpeta de sketch copia `secrets.example.h` como `secrets.h`. Introduce SSID, clave Wi-Fi, host del broker, usuario de esa placa, contraseña e ID común. Copia en ROOT_CA el certificado raíz PEM que indica tu proveedor. Las placas necesitan DNS, hora por NTP y salida TLS al puerto 8883.
3. Con el DevKit aislado del montaje, usa micro-USB de datos. Abre `firmware/Control/Control.ino`, selecciona la placa que corresponde a tu DevKit y su puerto. Compila y sube. Retira el USB.
4. Para MCI10660 usa su base de programación USB. Comprueba que tu revisión coincide con **AI Thinker ESP32-CAM + OV2640** antes de usar el mapa del sketch. Abre `firmware/Camara/Camara.ino`, selecciona **AI Thinker ESP32-CAM**, el puerto de la base y carga el programa. Usa el monitor serie a 115200 para comprobar “Camara lista”. Desenchufa USB antes del montaje.

| Campo en cada secrets.h | Valor que debes copiar |
|---|---|
| WIFI_SSID / WIFI_PASSWORD | Nombre exacto y clave de una red de 2,4 GHz con Internet. El código usa SSID y clave; una red institucional con portal cautivo o autenticación empresarial puede requerir otra red autorizada. |
| BROKER_HOST / DEVICE_ID | Host DNS sin protocolo ni puerto / mismo ID que en Android, por ejemplo equipo01. |
| BROKER_USER / BROKER_PASSWORD | Cuenta del controlador en Control y cuenta de la cámara en Camara. |
| ROOT_CA | Sustituye todo el bloque de certificado de ejemplo por la raíz PEM real, conservando BEGIN CERTIFICATE, END CERTIFICATE y el delimitador C++ exterior. |

**Prueba con USB antes de armar.** Con el controlador aislado de todas las señales y de la fuente externa, mantenlo alimentado solo por USB después de cargarlo. Observa en MQTTX la llegada de state. Esto comprueba el firmware y la red antes de probar la fuente. Luego desconecta el USB. [Instalación oficial Arduino-ESP32](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html)

## Alimentación y cambio de USB a fuente

**Identifica primero la fuente física.** La foto de referencia muestra MW122A (entrada 110–120 V CA). No conectes esa versión directamente a 220 V. Lee INPUT en la unidad del instituto. Para la variante MW2122A, Philmore especifica 3 / 4,5 / 6 / 7,5 / 9 / 12 V CC y hasta 2 A. Ese selector carece de posición de 5 V. Mantén desconectado el servo que dejó el profesor hasta verificar alimentación y polaridad.

1. Con todo apagado identifica bornes de salida CC, selector, modelo completo de ambas placas, entradas de alimentación y señal del MG996R. “XX5S69” por sí solo no confirma el pinout. Verifica con el docente que es un ESP32 clásico y que D5 corresponde a GPIO5.
2. Para usar esa MW2122A como única fuente primaria hace falta añadir una etapa reguladora adecuada. Ejemplo de laboratorio: salida de 9 V hacia la entrada de un convertidor reductor de CC y ajuste de su salida a **5,0 V**. Comprueba que regulador, cables y bornes admiten la corriente de pico conjunta y que la entrada queda dentro del límite de la fuente. Solicita la aprobación del montaje al encargado del laboratorio si la capacidad del servo bajo carga es desconocida.
3. Con el circuito desconectado ajusta y mide el lado de salida del regulador con multímetro en voltaje CC. Punta negra en OUT− y roja en OUT+. Verifica 5,0 V y polaridad. Apaga antes de cablear. Si no hay regulador apropiado, usa para la prueba una fuente de banco regulada a 5,0 V con capacidad comprobada. No uses 6 V directamente en la entrada 5V de las placas.
4. Conecta OUT+ al bus de distribución de 5 V y OUT− al bus de GND. Alimenta los carriles auxiliares de la protoboard desde esos buses. Usa una derivación corta de potencia desde los bornes para el servo: evita llevar su corriente por puentes finos o contactos de protoboard. Comprueba continuidad con todo apagado; muchos carriles están interrumpidos en el centro.
5. Comprueba la tensión en las entradas de cada placa y durante el movimiento del servo. Si hay reinicios, caída de tensión o limitación de corriente, corta alimentación y revisa el dimensionamiento. La cifra de 2 A describe la salida de la MW2122A. La corriente disponible a 5 V depende también del convertidor, la eficiencia y la carga.
6. Para programar, corta la fuente y desconecta la placa de los carriles y de las señales externas. Programa únicamente por su USB. Retira USB antes de reincorporarla al montaje. En funcionamiento ambas placas, sensores y servo se alimentan desde la salida común regulada.

**Primera puesta en marcha externa.** Con la salida apagada conecta únicamente el controlador al bus de 5 V y GND, tras identificar la entrada correcta. Retira USB, enciende la fuente y espera state en MQTTX. Apaga antes de añadir los sensores. Para cargar otro programa, vuelve a aislar la placa y usa USB como única alimentación.

[Ficha MW2122A](https://lkgind.com/CatalogDetail/31487) · [Referencia de alimentación de Espressif para DevKitC V4](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html)

## Mapa de conexiones por pin

| Elemento y terminal | Destino |
|---|---|
| ESP32 principal · entrada de 5 V verificada / GND | Bus regulado +5 V / GND común |
| MCI10660 · pin 5V / GND | Bus +5 V / GND común. Retira USB de la base. |
| MG996R · alimentación / retorno | Derivación de potencia +5 V / GND común |
| MG996R · señal | D5 del ESP32 principal, tras confirmar GPIO5 |
| HC-SR04 plato · VCC / GND / TRIG | +5 V / GND / GPIO19 |
| HC-SR04 plato · ECHO | Divisor A hacia GPIO21 |
| HC-SR04 tolva · VCC / GND / TRIG | +5 V / GND / GPIO18 |
| HC-SR04 tolva · ECHO | Divisor B hacia GPIO22 |

**Construye dos divisores independientes.** Por sensor: ECHO → resistencia de 1 kΩ → nodo de lectura. Desde el nodo lleva una resistencia de 2 kΩ a GND y un cable al GPIO indicado. Los 5 V del ECHO resultan en aproximadamente 3,33 V en el nodo. Verifica las resistencias y continuidad con la alimentación cortada. Nunca lleves ECHO directamente al GPIO.

Los colores de servo suelen ser rojo para alimentación, marrón o negro para GND y naranja para señal. Confirma mirando su conector o ficha. GPIO5 es pin de configuración al arranque del ESP32 clásico. Si falla el arranque con el servo conectado, apaga y prueba el DevKit aislado antes de revisar qué carga aplica el circuito a D5.

**Enlace entre placas.** Las dos placas se conectan por Wi-Fi de 2,4 GHz al broker y pueden estar en redes distintas con Internet. El DevKit reenvía las solicitudes de imagen a la cámara. UART es un enlace serie físico TX/RX; esta implementación usa mensajería IP y deja TX/RX libres para la programación. Las dos placas comparten la alimentación en paralelo.

**Verificación antes de encender.** Con equipos desconectados de toda alimentación, verifica continuidad entre los GND de las ramas y el bus negativo. Comprueba que los carriles + y − no estén unidos por un puente. En cada sensor sigue físicamente VCC, TRIG, ECHO y GND desde la serigrafía hasta su destino; la orientación del sensor en la mesa cambia el orden visual.

[Kit MCI10660](https://mcielectronics.cl/shop/product/tarjeta-de-desarrollo-esp32-cam-base-de-programacion/) · [Nivel lógico ECHO del HC-SR04](https://learn.adafruit.com/ultrasonic-sonar-distance-sensors/pinouts)

## Probar los sensores de uno en uno

**Plato.** Con el equipo apagado conecta solo el HC-SR04 del plato según la página anterior. Enciende y coloca una superficie plana frente al sensor. Lee cm en MQTTX. Repite a dos distancias medidas con una regla. El valor debe cambiar en el sentido correcto. La pantalla muestra distancia al plato; el software no dispensa automáticamente por proximidad.

**Tolva.** Apaga, incorpora el otro sensor con su propio divisor y enciende. Apunta el sensor hacia una superficie móvil. El campo level debe aumentar al acercar la superficie y disminuir al alejarla. Si aparece −1, registra “sin lectura” y revisa ECHO, TRIG, GND, orientación y rango. Una lectura de 0 % y una medición inválida tienen significados distintos.

**Calibración con la tolva instalada.** Mide en centímetros desde la cara emisora hasta el fondo útil de la tolva vacía. Escribe ese valor en EMPTY_CM. Llena hasta el máximo de uso, repite la medida y escribe FULL_CM. Mantén EMPTY_CM mayor que FULL_CM y vuelve a cargar Control.ino siguiendo el procedimiento de placa aislada.

**Ejemplo reproducible.** El sketch entregado usa vacío = 26 cm y lleno = 5 cm. Si mide 15 cm calcula (26 − 15) × 100 / (26 − 5) con división entera, que da **52 %**. El resultado se limita a 0–100 %. Ese porcentaje representa la altura estimada del alimento; los kilogramos dependen de la forma de la tolva y la densidad.

| Si observas | Qué revisar antes de seguir |
|---|---|
| Cambia cm al mover una superficie en la tolva | Revisa si intercambiaste los pares GPIO19/21 y GPIO18/22. |
| Cambia level pero el porcentaje queda saturado | Repite las dos medidas reales y comprueba que cargaste el firmware modificado. |
| Llegan state con intervalos regulares pero hay −1 | La comunicación MQTT funciona. Revisa primero el sensor y su divisor. |

Anota los valores finales de EMPTY_CM y FULL_CM junto al montaje. Así se puede repetir la calibración cuando cambie la posición del sensor o el recipiente.

## Calibrar el servo y comprobar la cámara

2. Apaga. Conecta el servo **sin el disco ni el brazo acoplado**. Los valores iniciales CLOSED=85 y OPEN=105 son ángulos de prueba. Despeja el recorrido, energiza y observa la posición de cierre. Espera al menos diez segundos tras arrancar y comprueba que haya nivel medible.
3. Desde la app pide **una porción**. Observa cmd, ack y state en MQTTX. El servo debe abrir y cerrar una vez. Con el montaje apagado, coloca el brazo en posición de cierre. Ajusta los ángulos gradualmente y repite sin forzar topes. Luego mide varias porciones en una balanza antes de usar alimento con una mascota.
4. El firmware admite 1–3 porciones, intervalo mínimo de 10 s, hasta 12 porciones por día UTC y reserva estimada de 4 puntos porcentuales por porción. La cuota real queda en memoria no volátil incluso después de un reinicio. Son parámetros de laboratorio; una porción representa un ciclo calibrable. El primer sensor registra distancia y la presencia por sí sola no mueve el servo.
5. En Cámara pulsa **Tomar fotografía**. Debe aparecer un JPEG y habilitarse **Guardar fotografía**. Activa **Vista en directo** para renovar las solicitudes mientras miras la pantalla. La cámara transmite JPEG QVGA sucesivos por MQTT, con intervalo mínimo de 550 ms. La velocidad real depende de Wi-Fi y broker; el envío se detiene al vencer la solicitud de 4,5 s.

**Durante el arranque.** El firmware ordena la posición CLOSED en setup al recibir energía. Mantén el mecanismo libre incluso antes de pulsar Dispensar. Detén el ensayo si el servo queda empujando un tope, aparece vibración sostenida o el ESP32 se reinicia.

**Cámara en el montaje final.** Con la fuente apagada incorpora el módulo por 5V y GND y deja libre su conector USB. Para obtener la primera foto deben estar en línea ambas placas: el controlador reenvía la petición. En una red con permisos de observación completos puedes seguir photo, camera/request y jpeg en ese orden.

## Prueba integral y evidencias de aceptación

1. Arranca las placas desde la fuente con el micro-USB retirado. Abre MQTTX en modo observador. Comprueba que el valor de cm cambia al mover una superficie frente al sensor del plato.
2. En Android ingresa con el usuario Firebase y conecta el broker. Observa el modo Equipo real y el indicador Telemetría activa. Comprueba que los valores de la app concuerdan con el último state.
3. Con el mecanismo calibrado, alimento suficiente, cuota disponible y después de la espera, selecciona una porción. Confirma una vez. Busca cmd y ack con el mismo id. Observa físicamente la apertura y el retorno a cierre.
4. Abre Historial y después Firestore → Datos. Navega hasta users → UID del usuario → feedings → ID del pedido. Verifica portions = 1 y el resultado final. Un ACK positivo demuestra que el firmware ejecutó las instrucciones; pesa el alimento si necesitas validar la ración.
5. Pide una foto desde Cámara. Comprueba que jpeg llega, que el fotograma se visualiza y que Guardar fotografía genera una imagen que puedes abrir en el teléfono.
6. Con el servo en reposo y sin un pedido pendiente, apaga el sistema. Tras unos diez segundos sin lecturas la app debe indicar telemetría vencida e impedir otra dispensación. Restablece la alimentación y verifica que vuelven las lecturas.

| Registra en la hoja de laboratorio | Resultado observado |
|---|---|
| Tensión medida en reposo y durante un ciclo | __________ V / __________ V |
| D5 confirmado y cierre/apertura calibrados | GPIO _____ / _____° / _____° |
| Calibración geométrica del sensor de tolva | Vacía _____ cm / llena _____ cm |
| ID común de cmd, ack e historial | ______________________________ |
| Masa obtenida en ciclos de una porción | _____ g / _____ g / _____ g |

Si un pedido queda pendiente o sin confirmación, revisa el mecanismo y el historial antes de repetirlo. Un corte puede producirse después del movimiento y antes de que el teléfono reciba el ACK.

## Diagnóstico y prueba manual con MQTTX

Ejemplo de state: `{"level":72,"cm":24,"nonce":"abc-def"}`. Para una prueba manual autorizada con el servo desacoplado, concede temporalmente permiso de publicación en cmd a un cliente de pruebas. Copia el nonce **actual** y publica una única vez sobre `dispensador/equipo01/cmd`, QoS 0, Retain desactivado:

```json
{"id":"prueba-banco-01","portions":1,"nonce":"COPIAR_NONCE_ACTUAL"}
```

Espera en ack el mismo id con ok verdadero o falso. Un nonce cambia periódicamente y tras ejecutar una orden aceptada. Una respuesta positiva confirma el ciclo del actuador; un sensor de peso sería necesario para confirmar los gramos. Los comandos manuales de MQTTX no aparecen en el historial personal de la app.

| Síntoma | Comprobación |
|---|---|
| App entra a simulación pero falla el registro | JSON del paquete correcto, reconstrucción, proveedor Email/Password y conexión a Firebase. |
| Broker conecta pero no hay lecturas | ID idéntico, permisos de state, Wi-Fi 2,4 GHz, NTP, CA y cuenta del DevKit. |
| Se rechaza la orden | Nonce vigente, lecturas válidas, mínimo de 4 % por porción, espera y cuota UTC. |
| Cámara sin imagen | Comprueba paso photo → camera/request → jpeg, CA de la cámara, límite de tamaño del broker y pinout OV2640. |
| Reinicios cuando gira el servo | Apaga y revisa caída de tensión, regulador, retorno común y cableado de potencia. |
| Historial sin permisos | Verifica UID y reglas de la base predeterminada del mismo proyecto Android. |

**Referencias de identificación y configuración**

- [Philmore · catálogo MW2122A](https://lkgind.com/CatalogDetail/31487)
- [MCI Electronics · kit ESP32-CAM MCI10660](https://mcielectronics.cl/shop/product/tarjeta-de-desarrollo-esp32-cam-base-de-programacion/)
- [Espressif · ESP32 y pines de arranque](https://documentation.espressif.com/esp32_datasheet_en.html)
- [Referencia de cableado · MG996R](https://www.digikey.in/htmldatasheets/production/5014637/0/0/1/mg996r.pdf)
- [Firebase · configuración Android](https://firebase.google.com/docs/android/setup)
- [MQTTX · guía de uso](https://mqttx.app/docs/get-started)

**Validación de esta entrega.** Se ejecutaron las pruebas C++ de la política de dosificación en el computador. La descarga de Gradle se bloqueó en este entorno y no se obtuvo APK. Quedan pendientes la compilación Android y de los sketches, pruebas con credenciales reales y la verificación física de fuente, placas y mecanismo.
