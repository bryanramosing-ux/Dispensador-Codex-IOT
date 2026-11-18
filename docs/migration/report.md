# Informe de migración

El destino de trabajo es el clon de `bryanramosing-ux/Dispensador-Codex-IOT` en la rama local `migration/nestjs-vue-firestore`. Se utilizó la rama predeterminada del repositorio original, fijada al commit `01d7ecd6ab3dec298c23e882c9e352de6288eb2b`. [Auditoría, inventario y referencia al commit](source-audit.md).

| Área | Resultado |
| --- | --- |
| API y dispositivos | NestJS con módulos de telemetría, dispositivo/UDP, comandos, eventos, cámara, historial, salud, seguridad y Firebase. |
| Interfaz | Vue 3, TypeScript y Vite con las cinco vistas, estilos originales, diálogo de confirmación, SSE con reconexión y alternativa de fotogramas. |
| Datos | Firestore con réplica transaccional, cursores e índices. SQLite mantiene cola y proyección operativa. Cloud Storage recibe JPEG con bucket configurado. |
| Seguridad | Sesión de administrador, CSRF, orígenes acotados, token de dispositivo, límites HTTP y de conexión, destinos HTTP privados y rechazo de redirecciones. |
| Firmware y archivos | DevKit y ESP32-CAM conservados byte a byte. 23 STL, 0 OBJ en el commit original. Se conservaron generadores, imágenes, diagramas, PDF, lista de materiales y video. Solo se actualizaron referencias de ubicación en guías y scripts auxiliares fuera del conjunto CAD. |
| Referencias | Backend y dashboard Python/JS originales en `scripts/legacy/` para pruebas. OpenCV opcional como servicio aparte en `hardware/OpenCV/`. |
| Entrega técnica | Monorepositorio npm, TypeScript, configuraciones, lockfile, scripts, tareas VS Code y CI. |

La [matriz de compatibilidad](compatibility.md) enumera contratos y diferencias justificadas. El [esquema](../firestore/schema.md) describe los límites de recuperación y el [registro de validación](validation.md) distingue las pruebas automatizadas de las verificaciones pendientes.
