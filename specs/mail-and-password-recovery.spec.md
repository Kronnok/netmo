# Especificación: correo y recuperación de contraseñas

## Objetivo y alcance

Implementar en NetMO el envío de correo mediante Brevo, Google Apps Script o
consola de desarrollo; notificaciones opcionales de reservas y devoluciones;
recuperación y cambio de contraseña con código de un solo uso; interfaz de
usuario correspondiente; y configuración/documentación de despliegue.

## Comportamiento esperado

- El servicio de correo usa las variables `MAIL_PROVIDER`, `MAIL_API_KEY`,
  `MAIL_GAS_URL`, `MAIL_GAS_SECRET`, `MAIL_FROM_EMAIL` y `MAIL_FROM_NAME`.
  Soporta `brevo`, `gas` y `console`; el proveedor GAS sigue redirecciones,
  corta a los 15 segundos y acepta solamente respuesta HTTP satisfactoria con
  cuerpo `ok`; consola solo en desarrollo. Faltantes de
  configuración en producción producen errores explícitos, sin exponer
  secretos ni interrumpir operaciones de negocio que notifican.
- `npm run mail:test -- destino@correo.com` envía un mensaje de prueba.
- Al confirmar una reserva o devolución, se envía aviso únicamente si la
  preferencia `email_notifications` del usuario es verdadera. Un fallo de
  correo se registra sin datos sensibles y no revierte la operación. Se quita
  del Perfil el aviso de que los envíos no están disponibles.
- La tabla `password_resets` almacena HMAC-SHA256 del código concatenado con
  el identificador del usuario, propósito, intentos, expiración y uso; nunca
  almacena el código en claro. La tabla se incorpora mediante una migración
  nueva y queda reflejada en `database/schema.sql`.
- Recuperar contraseña responde con el mismo mensaje y estado HTTP exista o no
  la cuenta. Genera códigos de seis dígitos con `crypto.randomInt`, expira en
  diez minutos, invalida solicitudes anteriores y aplica cooldown de 60
  segundos por usuario.
- Reset y cambio de contraseña validan vencimiento, uso, propósito y hasta
  cinco intentos; comparan el hash en tiempo constante; exigen contraseña de
  ocho o más caracteres sin espacios y actualizan el hash con `crypt` y
  `gen_salt('bf')` transaccionalmente. Los errores de reset son genéricos.
- El cambio requiere sesión y dispone de rutas de solicitud y confirmación.
  Estos endpoints usan limitación de intentos coherente con el limitador
  existente.
- El login ofrece recuperación mediante correo, código, contraseña nueva con
  repetición, mostrar/ocultar y reenvío. Perfil ofrece cambio de contraseña.
  Los valores dinámicos en HTML se escapan.
- `.env.example` lista únicamente nombres; `render.yaml` declara las nuevas
  variables privadas con `sync: false`; `DEPLOY.md` documenta Brevo y Apps
  Script sin publicar secretos.

## Criterios de aceptación

1. No se guardan ni se imprimen códigos, claves o secretos; la consola de
   correo no puede habilitarse en producción.
2. Todos los endpoints manejan entradas inválidas, expiración, uso,
   intentos y limitación de solicitudes sin revelar existencia de cuentas en
   recuperación.
3. Las operaciones de reservas y devoluciones se completan aunque falle el
   envío; las preferencias desactivadas impiden el envío.
4. Contraseñas se actualizan transaccionalmente y son utilizables para iniciar
   sesión.
5. Migración nueva y `schema.sql` describen el mismo esquema.
6. Pasan los tests existentes y los chequeos estáticos aplicables.

## Restricciones

- Sin dependencias nuevas; usar `fetch` y `crypto` nativos.
- No modificar migraciones aplicadas ni conectar a una base remota para probar.
- No cambiar comportamiento fuera del alcance ni incluir secretos en archivos
  versionados.
