# Spec pendiente: recuperación de contraseña con Gmail

## Objetivo
Implementar un flujo seguro de recuperación y cambio de contraseña para NetMO usando un correo real de Gmail como remitente (`netmo@gmail.com`), y validando la operación contra la base de datos PostgreSQL/Neon.

## Contexto
- El repositorio ya cuenta con una implementación base de recuperación de contraseña en `backend/services/password-reset-service.js`.
- La base de datos ya incluye la tabla `password_resets` y la estructura necesaria para almacenar códigos temporales y validaciones.
- El backend ya expone endpoints de recuperación:
  - `POST /api/auth/forgot`
  - `POST /api/auth/reset`
  - `POST /api/auth/change-password/request`
  - `POST /api/auth/change-password`
- El proyecto ya tenía soporte para proveedores `brevo`, `gas` y `console`, pero se elimina Brevo para este caso.
- El usuario quiere usar una cuenta de Google específica como remitente del correo de recuperación, por ejemplo `netmo@gmail.com`.

## Regla de negocio principal
- El código de verificación se envía al email del usuario registrado.
- El remitente del correo será la cuenta de NetMO (`netmo@gmail.com`).
- La validación del email, código, expiración, uso y actualización de la contraseña se hace en la base de datos de Neon.
- Gmail solo representa el canal de entrega del código, no la lógica de autorización ni la actualización de la contraseña.

## Flujo esperado
1. El usuario ingresa su email en la pantalla de "Olvidé mi contraseña".
2. El backend busca ese email en la tabla `users` de Neon.
3. Si existe, genera un código de 6 dígitos.
4. El backend guarda el código de forma segura en `password_resets` usando hash.
5. El backend envía el correo desde `netmo@gmail.com` al email del usuario.
6. El usuario ingresa el código y la nueva contraseña.
7. El backend valida:
   - que el usuario exista
   - que el código pertenece al usuario correcto
   - que no haya vencido
   - que no haya sido usado
   - que el intento no supere el límite
8. Si todo es correcto, actualiza `users.password_hash` y marca el registro de reset como usado.

## Entidades involucradas
- `users.email`: login y búsqueda del usuario.
- `password_resets`: almacenamiento del hash del código, expiración, contador de intentos y uso.
- `users.password_hash`: contraseña actual en formato seguro (`crypt` + `gen_salt('bf')`).

## Variables de entorno
```env
MAIL_PROVIDER=gmail
MAIL_GMAIL_USER=netmo@gmail.com
MAIL_GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
MAIL_FROM_EMAIL=netmo@gmail.com
MAIL_FROM_NAME=NetMO
```

## Requisitos técnicos
1. Soportar `MAIL_PROVIDER=gmail` en `backend/services/mail-service.js`.
2. El remitente debe ser `netmo@gmail.com`.
3. El destinatario debe ser el email real del usuario autenticado en la base de datos.
4. No guardar el código ni la contraseña en texto plano.
5. La operación de cambio de contraseña debe hacerse contra Neon/PostgreSQL.
6. El proveedor Gmail debe funcionar con una contraseña de aplicación de Google, no con la contraseña normal de la cuenta.
7. Brevo queda descartado por decisión del proyecto.

## Recomendación de seguridad
- Habilitar verificación en dos pasos en la cuenta Google.
- Generar una "Contraseña de aplicación" para `netmo@gmail.com`.
- Nunca hacer commit de secretos ni almacenar la contraseña de aplicación en el repositorio.

## Archivos previstos
- `backend/services/mail-service.js`: soporte de Gmail.
- `backend/package.json`: agregar `nodemailer`.
- `.env.example`: variables para `MAIL_PROVIDER=gmail`.
- `specs-pendientes/gmail-password-reset.md`: esta especificación.

## Criterio de aceptación
1. El correo de recuperación se envía al mail del usuario registrado.
2. El remitente del correo es `netmo@gmail.com`.
3. El backend cambia la contraseña en la base de datos de Neon solo si el código y el usuario son válidos.
4. El código no se guarda en texto plano.
5. La integración no publica secretos ni contraseñas en el repositorio.

## Notas de implementación
- El envío de correo se mantiene separado del cambio de contraseña.
- Gmail no reemplaza la lógica de Neon; solo es el transportador del código.
- Este flujo debe respetar la seguridad ya implementada en `password_reset_service` y en las validaciones del backend.
