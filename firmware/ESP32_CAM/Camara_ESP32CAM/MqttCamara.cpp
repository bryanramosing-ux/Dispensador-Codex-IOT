#include "MqttCamara.h"

#include <ArduinoJson.h>
#include <WiFi.h>
#include <atomic>
#include <esp_idf_version.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <mqtt_client.h>
#include <time.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets_ejemplo.h"
#endif

namespace {
constexpr char PEDIDO[] = "dispensador/" MQTT_SITE_ID "/camera/request";
constexpr char ESTADO[] = "dispensador/" MQTT_SITE_ID "/camera/status";
constexpr char FOTOS[] = "dispensador/" MQTT_SITE_ID "/camera/frame/";
constexpr time_t FECHA_MINIMA = 1700000000;
constexpr size_t MAX_JPEG = 400000;

struct Pedido {
  char datos[160];
};

esp_mqtt_client_handle_t mqtt = nullptr;
QueueHandle_t cola = nullptr;
std::atomic<bool> listo{false};
bool ntpIniciado = false;
uint32_t tConexion = 0;

void evento(void*, esp_event_base_t, int32_t tipo, void* datos) {
  auto* mensaje = static_cast<esp_mqtt_event_t*>(datos);
  if (tipo == MQTT_EVENT_CONNECTED) {
    esp_mqtt_client_subscribe(mensaje->client, PEDIDO, 0);
    return;
  }
  if (tipo == MQTT_EVENT_SUBSCRIBED) {
    listo.store(true);
    Serial.println("MQTT cámara conectado");
    return;
  }
  if (tipo == MQTT_EVENT_DISCONNECTED || tipo == MQTT_EVENT_ERROR) {
    listo.store(false);
    xQueueReset(cola);
    return;
  }
  Pedido pedido;
  if (tipo != MQTT_EVENT_DATA || mensaje->current_data_offset != 0 ||
      mensaje->data_len <= 0 || mensaje->data_len != mensaje->total_data_len ||
      (size_t)mensaje->data_len >= sizeof(pedido.datos) ||
      (size_t)mensaje->topic_len != sizeof(PEDIDO) - 1 ||
      memcmp(mensaje->topic, PEDIDO, sizeof(PEDIDO) - 1)) return;
  memcpy(pedido.datos, mensaje->data, mensaje->data_len);
  pedido.datos[mensaje->data_len] = '\0';
  xQueueSend(cola, &pedido, 0);
}

void conectar() {
  if (!cola || mqtt || WiFi.status() != WL_CONNECTED) return;
  if (!ntpIniciado) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpIniciado = true;
  }
  if (time(nullptr) < FECHA_MINIMA || (int32_t)(millis() - tConexion) < 0) return;
  tConexion = millis() + 10000;
  esp_mqtt_client_config_t config = {};
#if ESP_IDF_VERSION_MAJOR >= 5
  config.broker.address.hostname = MQTT_HOST;
  config.broker.address.port = MQTT_PORT;
  config.broker.address.transport = MQTT_TRANSPORT_OVER_SSL;
  config.broker.verification.certificate = MQTT_CA_PEM;
  config.credentials.username = MQTT_USERNAME;
  config.credentials.authentication.password = MQTT_PASSWORD;
  config.credentials.client_id = "disp-" MQTT_SITE_ID "-camera";
#else
  config.host = MQTT_HOST;
  config.port = MQTT_PORT;
  config.transport = MQTT_TRANSPORT_OVER_SSL;
  config.cert_pem = MQTT_CA_PEM;
  config.username = MQTT_USERNAME;
  config.password = MQTT_PASSWORD;
  config.client_id = "disp-" MQTT_SITE_ID "-camera";
#endif
  mqtt = esp_mqtt_client_init(&config);
  if (!mqtt) return;
  if (esp_mqtt_client_register_event(mqtt, MQTT_EVENT_ANY, evento, nullptr) != ESP_OK ||
      esp_mqtt_client_start(mqtt) != ESP_OK) {
    esp_mqtt_client_destroy(mqtt);
    mqtt = nullptr;
  }
}

bool idValido(const char* id) {
  if (strlen(id) != 36) return false;
  for (size_t i = 0; i < 36; ++i) {
    const char c = id[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
      return false;
    }
  }
  return true;
}
}

void prepararMqttCamara() {
  if (MQTT_HOST[0] && MQTT_USERNAME[0] && MQTT_PASSWORD[0] && MQTT_CA_PEM[0]) {
    cola = xQueueCreate(1, sizeof(Pedido));
  } else {
    Serial.println("MQTT cámara desactivado: complete secrets.h");
  }
}

void atenderMqttCamara(bool camaraLista, camera_fb_t* (*capturar)(), String (*leerEstado)()) {
  conectar();
  static bool conectadoAntes = false;
  static uint32_t ultimoEstado = 0;
  static bool listaAntes = false;
  if (!listo.load()) {
    conectadoAntes = false;
    return;
  }
  if (!conectadoAntes || camaraLista != listaAntes || millis() - ultimoEstado >= 30000) {
    conectadoAntes = true;
    listaAntes = camaraLista;
    ultimoEstado = millis();
    const String mensaje = String("{\"sentAt\":") + (unsigned long)time(nullptr) + ",\"data\":" + leerEstado() + "}";
    esp_mqtt_client_enqueue(mqtt, ESTADO, mensaje.c_str(), mensaje.length(), 0, false, true);
  }

  Pedido pedido;
  if (xQueueReceive(cola, &pedido, 0) != pdTRUE || !camaraLista) return;
  JsonDocument doc;
  if (deserializeJson(doc, pedido.datos)) return;
  const char* id = doc["id"] | "";
  const time_t vence = doc["expiresAt"] | 0L;
  const time_t ahora = time(nullptr);
  if (!idValido(id) || ahora < FECHA_MINIMA || vence <= ahora || vence > ahora + 15) return;
  camera_fb_t* imagen = capturar();
  if (!imagen) return;
  if (imagen->format == PIXFORMAT_JPEG && imagen->len > 0 && imagen->len <= MAX_JPEG && listo.load()) {
    const String tema = String(FOTOS) + id;
    esp_mqtt_client_enqueue(mqtt, tema.c_str(), reinterpret_cast<const char*>(imagen->buf), imagen->len, 0, false, true);
  }
  esp_camera_fb_return(imagen);
}
