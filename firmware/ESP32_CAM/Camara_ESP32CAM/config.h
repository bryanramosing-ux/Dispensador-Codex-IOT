// config.h - ESP32-CAM (AI-Thinker). Captura por MQTT y HTTP local.
#pragma once

// Imagen. VGA (640x480) es suficiente para el clasificador (entrada 224x224)
// y produce JPEG de pocas decenas de kB: transmisión rápida por Wi-Fi.
#define TAMANO_FOTO      FRAMESIZE_VGA
#define CALIDAD_JPEG     12        // 10-63 (menor = mejor calidad, más bytes)
#define USAR_FLASH       0         // LED GPIO4: muy brillante (puede asustar) y consume más
#define T_FLASH_MS       120

#define WIFI_REINTENTO_MS   5000UL
#define WIFI_REINICIO_MS  120000UL  // sin Wi-Fi 2 min -> reinicio
