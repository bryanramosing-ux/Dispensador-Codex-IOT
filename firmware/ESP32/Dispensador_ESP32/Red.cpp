#include "Red.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <time.h>

#include "config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets_ejemplo.h"
#endif

// SIMULACION_QEMU: solo para arrancar el firmware en el emulador QEMU de Espressif,
// que no emula la radio Wi-Fi. Nunca definirlo al compilar para la placa real.
#ifdef SIMULACION_QEMU
void Red::iniciar(const char*, const char*) { Serial.println("SIMULACION_QEMU: Wi-Fi desactivado"); }
bool Red::conectado() { return false; }
void Red::reconectar() { Serial.println("Wi-Fi: reintentando conexion... (simulado)"); }
String Red::ip() { return String("0.0.0.0"); }
int Red::rssi() { return 0; }
#else
void Red::iniciar(const char* ssid, const char* clave) {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  IPAddress ip, gw, mascara;
  if (strlen(IP_ESP32) > 0 && ip.fromString(IP_ESP32) && gw.fromString(IP_GATEWAY) &&
      mascara.fromString(IP_MASCARA)) {
    WiFi.config(ip, gw, mascara, gw);  // IP fija opcional (por defecto DHCP)
  }
  WiFi.begin(ssid, clave);
  // Espera acotada: si no hay Wi-Fi, el equipo arranca igual y sigue con el control local.
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
  if (conectado()) {
    Serial.printf("Wi-Fi OK  IP=%s  RSSI=%d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("Wi-Fi: sin conexion (se reintentara; el control local sigue activo)");
  }
}

bool Red::conectado() { return WiFi.status() == WL_CONNECTED; }

void Red::reconectar() {
  // Sin WiFi.disconnect(): cortaría un intento de asociación que todavía está en curso.
  Serial.println("Wi-Fi: reintentando conexion...");
  WiFi.reconnect();
}

String Red::ip() { return conectado() ? WiFi.localIP().toString() : String("0.0.0.0"); }
int Red::rssi() { return conectado() ? WiFi.RSSI() : 0; }
#endif

bool Red::getSimple(const String& url, uint32_t timeoutMs) {
  if (!conectado()) return false;
  HTTPClient http;
  http.setConnectTimeout(TIMEOUT_CONEXION_MS);
  http.setTimeout(timeoutMs);
  if (!http.begin(url)) return false;
  int codigo = http.GET();
  http.end();
  return codigo == 200;
}

bool Red::camaraDisponible() { return getSimple(String(URL_CAMARA) + "/status", TIMEOUT_ESTADO_MS); }

bool Red::servidorDisponible() { return getSimple(String(URL_VISION) + "/status", TIMEOUT_ESTADO_MS); }

// GET http://PC:8000/classify?dist=NN  ->  {"clase":1,"confianza":0.93,"motivo":"OK",...}
RespuestaClasificacion Red::clasificar(int distanciaCm) {
  RespuestaClasificacion r;
  if (!conectado()) {
    strncpy(r.motivo, "SIN_WIFI", sizeof(r.motivo) - 1);
    return r;  // tipo = ERROR_SERVIDOR
  }
  HTTPClient http;
  http.setConnectTimeout(TIMEOUT_CONEXION_MS);
  http.setTimeout(TIMEOUT_CLASIFICAR_MS);
  String url = String(URL_VISION) + "/classify?dist=" + String(distanciaCm);
  if (!http.begin(url)) {
    strncpy(r.motivo, "URL_INVALIDA", sizeof(r.motivo) - 1);
    return r;
  }
  int codigo = http.GET();
  if (codigo <= 0) {  // timeout, conexión rechazada, etc.
    snprintf(r.motivo, sizeof(r.motivo), "HTTP_ERR_%d", codigo);
    http.end();
    return r;
  }
  String cuerpo = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, cuerpo)) {
    strncpy(r.motivo, "JSON_INVALIDO", sizeof(r.motivo) - 1);
    return r;
  }
  const char* motivo = doc["motivo"] | "";
  strncpy(r.motivo, motivo, sizeof(r.motivo) - 1);
  int clase = doc["clase"] | -1;

  if (codigo == 502 && strcmp(motivo, "CAMARA_NO_RESPONDE") == 0) {
    r.tipo = TipoRespuesta::ERROR_CAMARA;
  } else if (codigo == 200 && clase >= CLASE_INDETERMINADA && clase <= CLASE_GATO) {
    r.tipo = TipoRespuesta::OK;
    r.clase = clase;
    r.confianza = doc["confianza"] | 0.0f;
  }  // cualquier otro caso queda como ERROR_SERVIDOR
  return r;
}

#ifdef SIMULACION_QEMU
void Red::iniciarMqtt(const ManejadoresRed&) {}
void Red::atender() {}
bool Red::backendConocido() const { return false; }
bool Red::publicar(const char*, const String&) { return false; }
#else
#include <esp_idf_version.h>

namespace {
const char COMANDO[] = "dispensador/" MQTT_SITE_ID "/esp32/command";
const char ACUSE[] = "dispensador/" MQTT_SITE_ID "/esp32/ack";
const time_t FECHA_MINIMA = 1700000000;

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

void Red::iniciarMqtt(const ManejadoresRed& manejadores) {
  if (!MQTT_HOST[0] || !MQTT_USERNAME[0] || !MQTT_PASSWORD[0] || !MQTT_CA_PEM[0]) {
    Serial.println("MQTT desactivado: complete secrets.h");
    return;
  }
  m_ = manejadores;
  comandos_ = xQueueCreate(4, sizeof(Mensaje));
}

bool Red::backendConocido() const { return mqttListo_.load(); }

void Red::conectarMqtt() {
  if (!comandos_ || !conectado() || mqtt_) return;
  if (!ntpIniciado_) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpIniciado_ = true;
  }
  if (time(nullptr) < FECHA_MINIMA || (int32_t)(millis() - siguienteConexion_) < 0) return;
  siguienteConexion_ = millis() + 10000;

  esp_mqtt_client_config_t config = {};
#if ESP_IDF_VERSION_MAJOR >= 5
  config.broker.address.hostname = MQTT_HOST;
  config.broker.address.port = MQTT_PORT;
  config.broker.address.transport = MQTT_TRANSPORT_OVER_SSL;
  config.broker.verification.certificate = MQTT_CA_PEM;
  config.credentials.username = MQTT_USERNAME;
  config.credentials.authentication.password = MQTT_PASSWORD;
  config.credentials.client_id = "disp-" MQTT_SITE_ID "-esp32";
#else
  config.host = MQTT_HOST;
  config.port = MQTT_PORT;
  config.transport = MQTT_TRANSPORT_OVER_SSL;
  config.cert_pem = MQTT_CA_PEM;
  config.username = MQTT_USERNAME;
  config.password = MQTT_PASSWORD;
  config.client_id = "disp-" MQTT_SITE_ID "-esp32";
#endif
  mqtt_ = esp_mqtt_client_init(&config);
  if (!mqtt_) return;
  if (esp_mqtt_client_register_event(mqtt_, MQTT_EVENT_ANY, eventoMqtt, this) != ESP_OK ||
      esp_mqtt_client_start(mqtt_) != ESP_OK) {
    esp_mqtt_client_destroy(mqtt_);
    mqtt_ = nullptr;
  }
}

void Red::eventoMqtt(void* contexto, esp_event_base_t, int32_t evento, void* datos) {
  auto& red = *static_cast<Red*>(contexto);
  auto* mensaje = static_cast<esp_mqtt_event_t*>(datos);
  if (evento == MQTT_EVENT_CONNECTED) {
    esp_mqtt_client_subscribe(mensaje->client, COMANDO, 0);
    return;
  }
  if (evento == MQTT_EVENT_SUBSCRIBED) {
    red.mqttListo_.store(true);
    Serial.println("MQTT conectado");
    return;
  }
  if (evento == MQTT_EVENT_DISCONNECTED || evento == MQTT_EVENT_ERROR) {
    red.mqttListo_.store(false);
    xQueueReset(red.comandos_);
    return;
  }
  Mensaje copia;
  if (evento != MQTT_EVENT_DATA || mensaje->current_data_offset != 0 ||
      mensaje->data_len <= 0 || mensaje->data_len != mensaje->total_data_len ||
      (size_t)mensaje->data_len >= sizeof(copia.bytes) ||
      (size_t)mensaje->topic_len != sizeof(COMANDO) - 1 ||
      memcmp(mensaje->topic, COMANDO, sizeof(COMANDO) - 1) != 0) return;
  memcpy(copia.bytes, mensaje->data, mensaje->data_len);
  copia.bytes[mensaje->data_len] = '\0';
  xQueueSend(red.comandos_, &copia, 0);
}

bool Red::publicar(const char* tema, const String& json) {
  return backendConocido() &&
         esp_mqtt_client_enqueue(mqtt_, tema, json.c_str(), json.length(), 0, false, true) >= 0;
}

void Red::manejarComando(const char* mensaje) {
  JsonDocument doc;
  if (deserializeJson(doc, mensaje)) return;
  const char* id = doc["id"] | "";
  const time_t expiracion = doc["expiresAt"] | 0L;
  const time_t ahora = time(nullptr);
  if (!idValido(id) || ahora < FECHA_MINIMA || expiracion <= ahora || expiracion > ahora + 15) return;
  for (const auto& anterior : recientes_) {
    if (strcmp(anterior, id) == 0) return;
  }

  const char* operacion = doc["operation"] | "";
  const char* resultado = nullptr;
  bool ok = false;
  if (strcmp(operacion, "dispense") == 0 && m_.dispensar) {
    const int porciones = doc["portions"].is<int>() ? doc["portions"].as<int>() : 0;
    const Solicitud respuesta = porciones >= 1 && porciones <= MAX_PORCIONES_MANUAL
      ? m_.dispensar((uint8_t)porciones) : Solicitud::PORCIONES_INVALIDAS;
    ok = respuesta == Solicitud::ACEPTADA;
    resultado = nombreSolicitud(respuesta);
  } else if (strcmp(operacion, "reset-errors") == 0 && m_.borrarErrores) {
    ok = true;
    resultado = m_.borrarErrores() ? "ERRORES_BORRADOS" : "SIN_ERRORES";
  }
  if (!resultado) return;
  memcpy(recientes_[proximoId_], id, 37);
  proximoId_ = (proximoId_ + 1) % 8;

  char acuse[180];
  snprintf(acuse, sizeof(acuse), "{\"id\":\"%s\",\"ok\":%s,\"resultado\":\"%s\",\"cooldown_s\":%lu}",
           id, ok ? "true" : "false", resultado, (unsigned long)(m_.cooldownS ? m_.cooldownS() : 0));
  publicar(ACUSE, String(acuse));
}

void Red::atender() {
  conectarMqtt();
  Mensaje mensaje;
  if (backendConocido() && xQueueReceive(comandos_, &mensaje, 0) == pdTRUE) manejarComando(mensaje.bytes);
}
#endif

bool Red::enviarTelemetria(const String& json) {
  return publicar("dispensador/" MQTT_SITE_ID "/esp32/telemetry",
                  String("{\"sentAt\":") + (unsigned long)time(nullptr) + ",\"data\":" + json + "}");
}

bool Red::notificar(const char* tipo, float nivelPct) {
  char mensaje[160];
  snprintf(mensaje, sizeof(mensaje),
           "{\"sentAt\":%lu,\"data\":{\"tipo\":\"%s\",\"nivel\":%.0f}}",
           (unsigned long)time(nullptr), tipo, nivelPct);
  return publicar("dispensador/" MQTT_SITE_ID "/esp32/alert", String(mensaje));
}
