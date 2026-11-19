// Copie este archivo como "secrets.h" (no se sube a GitHub) y complete los datos.
#pragma once
#define WIFI_SSID  "NOMBRE_DE_SU_RED_2.4GHz"
#define WIFI_CLAVE "CONTRASENA"

// IP fija opcional si se usa OpenCV en la red local. Vacío = DHCP.
#define IP_CAMARA    ""
#define IP_GATEWAY   "192.168.1.1"
#define IP_MASCARA   "255.255.255.0"

// MQTT sobre TLS (credenciales propias de esta cámara).
#define MQTT_HOST     ""
#define MQTT_PORT     8883
#define MQTT_SITE_ID  "mi-dispensador"
#define MQTT_USERNAME ""
#define MQTT_PASSWORD ""
#define MQTT_CA_PEM   ""
