// Wi-Fi y transporte MQTT. La máquina de estados se ejecuta en el lazo Arduino.
#pragma once
#include <Arduino.h>
#include "Controlador.h"

#ifndef SIMULACION_QEMU
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <mqtt_client.h>
#endif

struct ManejadoresRed {
  Solicitud (*dispensar)(uint8_t porciones) = nullptr;
  bool (*borrarErrores)() = nullptr;
  uint32_t (*cooldownS)() = nullptr;
};

class Red {
 public:
  void iniciar(const char* ssid, const char* clave);
  void iniciarMqtt(const ManejadoresRed& manejadores);
  void atender();
  bool conectado();
  bool backendConocido() const;
  void reconectar();
  String ip();
  int rssi();
  bool enviarTelemetria(const String& json);
  bool notificar(const char* tipo, float nivelPct);

  bool camaraDisponible();
  bool servidorDisponible();
  RespuestaClasificacion clasificar(int distanciaCm);

 private:
  bool getSimple(const String& url, uint32_t timeoutMs);
  bool publicar(const char* tema, const String& json);
#ifndef SIMULACION_QEMU
  struct Mensaje {
    char bytes[224];
  };
  static void eventoMqtt(void* contexto, esp_event_base_t, int32_t evento, void* datos);
  void conectarMqtt();
  void manejarComando(const char* mensaje);
  ManejadoresRed m_;
  esp_mqtt_client_handle_t mqtt_ = nullptr;
  QueueHandle_t comandos_ = nullptr;
  std::atomic<bool> mqttListo_{false};
  bool ntpIniciado_ = false;
  uint32_t siguienteConexion_ = 0;
  char recientes_[8][37] = {};
  uint8_t proximoId_ = 0;
#endif
};
