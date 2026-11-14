# Recuperación de contraseña

**Estado:** Reemplazada.

Reemplazada: se usa MAIL_PROVIDER=gas; SMTP/nodemailer no funciona en Render gratis.

La implementación vigente usa códigos de un solo uso, almacenados con hash
HMAC, y entrega mediante Google Apps Script. No se configura SMTP.
