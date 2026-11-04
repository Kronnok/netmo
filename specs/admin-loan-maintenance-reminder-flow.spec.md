# Especificación: préstamos, mantenimiento y recordatorios

## Estado

Aprobada según el pedido explícito del propietario.

## Hechos observados

- El GET administrativo de préstamos y su lista sin búsqueda, las reglas de
  vencimiento y el límite mínimo ya están implementados en el commit anterior.
- El flujo de devolución y el mantenimiento por tickets tienen lógica
  transaccional; las pruebas PostgreSQL existentes no recorren todavía un
  préstamo creado por un profesor hasta la devolución directa del administrador
  ni un ticket del dueño de un equipo prestado a través de la devolución.
- `sendReturnReminders` marca `reminder_sent_at` antes de enviar el correo. La
  notificación genérica absorbe errores, por lo que la operación puede contar
  como enviada aunque el correo haya fallado.
- La pantalla de administración no ofrece una acción manual para recordatorios
  y no existe la ruta admin solicitada.
- El aviso en Inicio y Mis préstamos, con refresco cada 60 segundos, ya existe.
- Perfil muestra el control de preferencias, pero no explica cuándo se envía el
  correo.

## Comportamiento esperado y criterios de aceptación

1. **Entrega/devolución:** ampliar la prueba PostgreSQL aislada para que un
   profesor reserve, admin registre checkout, el préstamo figure en Mis
   préstamos y en `/api/admin/loans` sin búsqueda, y admin lo devuelva
   directamente. Checkout y devolución refrescan el estado después del éxito;
   los errores muestran el mensaje de API sin reemplazarlo.
2. **Ticket/mantenimiento:** pruebas PostgreSQL cubren reporte del dueño mientras
   la notebook está prestada, devolución a mantenimiento, tickets abiertos y
   en progreso múltiples, resolución del último ticket activo y equipo
   disponible que pasa a mantenimiento al crear ticket o al avanzarlo. Mantener
   casts `ticket_status` y `bigint`.
3. **Recordatorios:** enviar primero y marcar `reminder_sent_at` solo tras
   respuesta satisfactoria del proveedor. Correo fallido deja el préstamo
   elegible para reintento. Agregar `POST /api/admin/reminders/run`, protegido
   por rol admin, y botón administrativo. El endpoint cron mantiene el requisito
   de `x-cron-secret` y responde 401 si falta o no coincide. Pruebas con hora
   controlada verifican vencimiento en 20 minutos con umbral 30, idempotencia,
   umbral 0, notificaciones desactivadas y vencimiento ya pasado.
4. **Avisos y perfil:** preservar y probar el aviso en app para Inicio y Mis
   préstamos con refresco cada 60 segundos. Perfil indica bajo la preferencia
   de correo: «El recordatorio por correo se envía cuando falten X minutos para
   el vencimiento»; el valor se actualiza con la preferencia elegida y el estado
   desactivado se comunica claramente.
5. Suite completa sin regresiones respecto de la línea base. Ejecutar integración
   únicamente con `TEST_DATABASE_URL` segura; nunca producción. No crear
   migración salvo que sea demostrablemente necesaria.

## Restricciones

- Mantener cambios acotados, APIs existentes y mensajes de error del backend.
- No tocar datos remotos ni secretos; no añadir dependencias.
- Commit local claro, sin push ni `--force`.
