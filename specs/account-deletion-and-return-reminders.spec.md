# Especificación: baja con borrado de datos y recordatorios de devolución

## Estado

Implementada.

## Objetivo

1. Permitir que un administrador elimine una cuenta borrando sus datos
   personales, de modo que el mismo correo y DNI puedan volver a registrarse,
   sin perder el historial de préstamos, devoluciones y tickets.
2. Implementar el envío real de recordatorios de devolución respetando la
   preferencia de cada usuario (0/15/30/60 minutos) y sin duplicados.

## Baja de cuentas

- `DELETE /api/admin/users/:dni` anonimiza la fila dentro de una transacción:
  - `nombre = 'Cuenta eliminada'`
  - `email = 'eliminado+<id>@netmo.invalid'`
  - `dni = 'ELIM-<id>'`
  - contraseña aleatoria e inutilizable
  - `eliminado_at = now()`, `estado_registro = 'rechazado'`
- Se eliminan `password_resets` y `user_preferences` de la cuenta y se cancelan
  sus reservas activas, liberando las notebooks asignadas.
- Se audita la acción como `baja_usuario`.
- No se puede eliminar la propia cuenta, una cuenta administradora ni una cuenta
  con préstamos sin devolver.
- La baja es irreversible: se elimina `POST /api/admin/users/:dni/restore` y el
  panel «Cuentas eliminadas» de la interfaz.
- Las cuentas eliminadas antes de esta migración se anonimizan con
  `017-anonymize-deleted-users.sql`. Si una cuenta legacy eliminada intenta
  registrarse, el servidor la anonimiza y crea la cuenta nueva.
- El historial permanece asociado a la fila anonimizada porque las claves foráneas
  de préstamos, tickets y tardanzas son obligatorias.

## Recordatorios

- `POST /api/internal/reminders` (cron con `x-cron-secret`) y
  `POST /api/admin/reminders/run` (admin) ejecutan el mismo proceso.
- Se seleccionan préstamos no devueltos, de usuarios activos y aprobados, con
  `email_notifications = TRUE`, `return_reminder_minutes > 0`,
  `reminder_sent_at IS NULL` y `vence_at <= now() + intervalos del umbral`
  (incluye vencidos).
- El correo se envía antes de marcar `reminder_sent_at`; un fallo deja el
  préstamo elegible para el próximo intento.
- `pg_try_advisory_lock` evita ejecuciones simultáneas.
- La aprobación de una cuenta y los avisos de entrega respetan
  `email_notifications`; el aviso de entrega se envía una sola vez por retiro.

## Compatibilidad y otras correcciones

- El backup incluye las tablas ordenadas por clave para que la restauración
  reproduzca exactamente el mismo contenido.
- La validación de backup acepta `users.registro_revisado_at`,
  `users.registro_revisado_por` y `ticket_replies.author_id` nulos.
- La prueba de integración cubre baja, re-registro con el mismo correo y DNI,
  recordatorios por umbral, sin duplicados y con notificaciones desactivadas.

## Verificación

- `npm.cmd test --prefix backend` sin fallos.
- `node backend/scripts/run-integration.js` con `TEST_DATABASE_URL` local aislada.
- Envío real de correo de prueba con Brevo a la cuenta indicada por el dueño.
