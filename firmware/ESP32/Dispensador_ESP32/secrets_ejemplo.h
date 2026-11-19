// Copie este archivo como "secrets.h" (no se sube a GitHub) y complete los datos
// de SU red. Nunca escriba datos reales en este archivo de ejemplo.
#pragma once

// --- Wi-Fi (2,4 GHz, WPA2-Personal) -------------------------------------------
#define WIFI_SSID  "NOMBRE_DE_SU_RED_2.4GHz"
#define WIFI_CLAVE "CONTRASENA"

// --- MQTT sobre TLS (credenciales propias del controlador) -------------------
#define MQTT_HOST     ""   // Solo nombre DNS del broker, sin mqtts://
#define MQTT_PORT     8883
#define MQTT_SITE_ID  "mi-dispensador"
#define MQTT_USERNAME ""
#define MQTT_PASSWORD ""
#define MQTT_CA_PEM   ""   // Pegue el certificado raíz PEM con saltos de línea escapados (ver manual)

// --- IP del ESP32 ----------------------------------------------------------------
// "" = DHCP (recomendado). El panel remoto usa el broker MQTT.
// IP fija: complete los tres valores según SU red (deben coincidir con el router).
#define IP_ESP32    ""
#define IP_GATEWAY  "192.168.1.1"
#define IP_MASCARA  "255.255.255.0"

// --- Solo para el modo automático opcional (USAR_DETECCION_AUTOMATICA 1) --------
#define URL_VISION  "http://192.168.1.50:8000"   // OpenCV/servidor_vision.py
#define URL_CAMARA  "http://192.168.1.51"        // ESP32-CAM
