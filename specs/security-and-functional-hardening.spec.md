# Especificación: endurecimiento de seguridad y reglas de negocio

## Objetivo y alcance

Aplicar los 14 puntos solicitados para zona horaria de reservas/vencimientos,
tokens HMAC con caducidad, autorización administrativa, roles y registro,
escape XSS, protección del login y headers, rechazo de lotes, límites del
inventario manual, datos reales de demoras, aviso de notificaciones y
documentación/configuración. No añadir dependencias ni conectar a la BDD
remota. Conservar los cambios preexistentes fuera de este alcance.

## Comportamiento esperado y aceptación

1. Interpretar y validar reservas según `America/Argentina/Buenos_Aires` en
   Node y PostgreSQL; calcular vencimientos como ocho horas desde el retiro.
   Las funciones de triggers se reflejan en `schema.sql` y en una migración
   nueva, sin modificar migraciones existentes.
2. Firmar tokens con HMAC usando `JWT_SECRET`, con expiración a las 12 horas;
   requerir el secreto en producción y configurarlo en Render y `.env.example`.
3. Exigir rol administrador en cada endpoint `/api/admin/*`.
4. Crear nuevas cuentas como `alumno`; agregar cambio de rol protegido para
   `alumno`/`profesor`, sin modificar admins, y habilitarlo desde la UI.
5. Escapar con un helper común cualquier dato dinámico interpolado en
   `innerHTML`.
6. No mantener la contraseña en el objeto de usuario del frontend.
7. Limitar login por IP+email a cinco fallos en quince minutos, devolver 429
   al exceder el límite, emitir headers básicos y requerir ocho caracteres
   para nuevas contraseñas.
8. Añadir rechazo transaccional de lotes pendientes/aprobados y conectarlo
   a la interfaz.
9. Quitar el alta de notebooks de la interfaz, sin crear API de alta.
10. Permitir cambiar manualmente notebooks solo a `disponible` o
    `mantenimiento`, tanto en API como interfaz.
11. Mostrar datos de tardanzas de la API en modo API, sin depender de usuarios
    de demo.
12. Informar visiblemente que el envío de correos aún no está disponible.
13. Asegurar `.env.example` sin secretos; documentar secreto y migración en
    README, STACK y DEPLOY, sin menciones a Docker/Nginx en esos documentos.
14. Probar permisos de todos los endpoints administrativos, firma/expiración
    de tokens y rechazo transaccional; ejecutar la suite completa.

## Restricciones

- No revelar ni versionar valores reales de secretos o contraseñas.
- No modificar ni consultar la BDD remota.
- Sin dependencias nuevas, refactors ajenos, `--force` ni cambios destructivos.
- No incluir en el commit cambios preexistentes ajenos a la tarea.
