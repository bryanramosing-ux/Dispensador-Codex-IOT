# Pruebas unitarias de la lógica del controlador, PWM y NVS.
CXX ?= g++
FLAGS = -std=gnu++17 -Wall -Wextra -Wno-unused-parameter
FW = ../Dispensador_ESP32

.PHONY: pruebas clean
pruebas: test_controlador test_dosificador_2 test_dosificador_3 test_historial
	./test_controlador
	./test_dosificador_2
	./test_dosificador_3
	./test_historial

test_dosificador_%: test_dosificador.cpp $(FW)/Dosificador.cpp $(FW)/Dosificador.h $(FW)/config.h
	$(CXX) $(FLAGS) -O1 -DESP_ARDUINO_VERSION_MAJOR=$* -Istubs -o $@ test_dosificador.cpp $(FW)/Dosificador.cpp

test_historial: test_historial.cpp $(FW)/HistorialNVS.h stubs/Preferences.h
	$(CXX) $(FLAGS) -O1 -Istubs -o $@ test_historial.cpp

test_controlador: test_controlador.cpp $(FW)/Controlador.cpp $(FW)/Controlador.h $(FW)/NivelGeometria.h
	$(CXX) $(FLAGS) -O1 -o $@ test_controlador.cpp $(FW)/Controlador.cpp

clean:
	rm -f test_controlador test_dosificador_2 test_dosificador_3 test_historial
