#pragma once
#include <Arduino.h>
#include "esp_camera.h"

void prepararMqttCamara();
void atenderMqttCamara(bool camaraLista, camera_fb_t* (*capturar)(), String (*leerEstado)());
