 Deploy gratuito

Neon aloja PostgreSQL, Render ejecuta la API y Cloudflare Pages o Netlify sirve
el frontend estático.

## 1. PostgreSQL 16 en Neon

Creá un proyecto Neon PostgreSQL 16 y configurá la cadena de conexión directa
con SSL (`sslmode=require`) como `DATABASE_URL`. No publiques la URL ni la copies
a archivos versionados. Ejecutá desde la raíz del proyecto:

```sh
npm run db:migrate
npm run db:seed
```

Definí `DATABASE_URL` y las cuatro variables `NETMO_SEED_*_PASSWORD` de
[`.env.example`](./.env.example) en tu entorno local antes de esos comandos.
`db:seed` registra la versión `002-seed` y no vuelve a insertar los datos si
esa versión ya está aplicada. Rotá cualquier credencial que haya sido expuesta
antes de usar la base en producción.

`npm run db:migrate` aplica migraciones nuevas sin modificar las ya aplicadas.
Las reservas usan la zona `America/Argentina/Buenos_Aires`, de lunes a viernes,
08:00–11:50 y 13:30–17:40, y rechazan fechas pasadas. Las migraciones agregan
también baneos con vencimiento y la relación de inventario con carros; el
backfill conserva la ubicación existente y asigna `carro_id` cuando contiene un
número de carro válido. La migración 010 renombra `users.legajo` a `users.dni`
sin alterar sus valores, agrega ubicaciones a los carros y actualiza la relación
de notebooks para permitir renumerarlos. La migración 011 crea el catálogo
editable de ubicaciones, agrega el estado de envío del recordatorio de
vencimiento y habilita respuestas en tickets. La migración 013 relaciona cada
reporte de falla con el préstamo seleccionado sin alterar reportes anteriores.

## 2. API en Render

Importá el repositorio en Render usando [render.yaml](./render.yaml). En el
servicio completá:

- `DATABASE_URL`: cadena de Neon con `sslmode=require`.
- `CORS_ORIGIN`: origen exacto de Pages o Netlify (sin rutas), por ejemplo
  `https://netmo.pages.dev`.
- `JWT_SECRET`: secreto de firma HMAC de los tokens, válidos durante 12 horas.
  `render.yaml` solicita que Render lo genere automáticamente; conservá ese
  valor como secreto y no lo copies al repositorio.
- `MAIL_PROVIDER`: elegí `brevo` o `gas`; configurá también las variables
  requeridas del proveedor y `MAIL_FROM_EMAIL`/`MAIL_FROM_NAME`. No uses
  `console` en producción.
- `LOGIN_LOCK_MINUTES`: ventana de bloqueo de login en minutos (mínimo 1,
  predeterminado 2; se mantienen cinco fallos).
- `CRON_SECRET`: secreto generado para Render y usado por el cron externo de
  recordatorios; es obligatorio en producción.

  El registro público de cuentas se hace desde el inicio de sesión y cada
  solicitud queda pendiente de aprobación hasta que un administrador la apruebe o
  rechace en la sección **Usuarios**. El rol se deriva del dominio; para
  `@gmail.com` el administrador elige alumno o profesor al aprobar. Una solicitud
  rechazada puede volver a registrarse corrigiendo sus datos. Los DNI nuevos deben
  tener de 7 a 10 dígitos.
  Desde **Inventario** se administran carros, ubicaciones y altas consecutivas de
  notebooks. El correo de entrega de una notebook es transaccional: se envía
  siempre al registrar la entrega, sin depender de las preferencias del usuario.

Render publica la API y comprueba `/health`. Configurá `DATABASE_URL` y
`CORS_ORIGIN` como variables privadas del servicio; `JWT_SECRET` se genera en
Render a partir del manifiesto. Después de cambiar el esquema, volvé a ejecutar
`npm run db:migrate` desde un entorno seguro.

### Configurar correo

**Brevo:** verificá el remitente en Brevo, generá una API key y cargala como
`MAIL_API_KEY` en Render. Usá `MAIL_PROVIDER=brevo` y configurá
`MAIL_FROM_EMAIL` y `MAIL_FROM_NAME`. La API sigue redirecciones y espera como
máximo 15 segundos. Si la clave tiene “Restrict to IP addresses”, desactivala:
el plan free de Render no tiene una IP de salida fija. Después de cambiar
cualquier variable `MAIL_*`, guardá los cambios y hacé un **Manual Deploy**
para que el servicio reinicie con la configuración nueva.

El Perfil cambia la contraseña con un código de 6 dígitos que se envía al correo
registrado, así que ese flujo depende del correo (la variante con contraseña
actual se conserva por compatibilidad). Si el envío de un código falla, la API
responde 503 y el código emitido queda invalidado, y el reintento no queda
bloqueado por el cooldown de un minuto; “Olvidé mi contraseña” mantiene una
respuesta genérica y registra el detalle real solo en los logs del servidor.

**Google Apps Script:** creá un proyecto con una función `doPost` que lea el
JSON recibido (`secret`, `to`, `subject`, `html`), compare `secret` con un
secreto guardado en las propiedades del script, envíe con `MailApp.sendEmail`
y devuelva texto plano `ok`. Desplegalo como aplicación web ejecutada por tu
cuenta y accesible para recibir solicitudes; copiá su URL de implementación a
`MAIL_GAS_URL`, el mismo secreto a `MAIL_GAS_SECRET` y seleccioná
`MAIL_PROVIDER=gas`. La API sigue redirecciones y espera como máximo 15
segundos.

Los códigos de recuperación se guardan hasheados y se validan en PostgreSQL.
El envío usa las APIs HTTPS de Brevo o Apps Script; SMTP/nodemailer no funciona
en Render gratis. En desarrollo podés usar `MAIL_PROVIDER=console`; no agregues
secretos al repositorio.

### Recordatorios de devolución

Configurá `CRON_SECRET` en el servicio de Render. Un cron externo gratuito debe
hacer una solicitud HTTPS cada cinco minutos a
`POST https://<API>/api/internal/reminders` con el encabezado
`x-cron-secret: <CRON_SECRET>` y sin cuerpo. Por ejemplo, en cron-job.org se
crea un trabajo HTTP POST con esa URL y ese encabezado, en intervalo de cinco
minutos. Guardá el valor del encabezado como secreto en el proveedor, nunca en
el repositorio. Render gratuito puede dormir; un `setInterval` dentro de la
API no garantiza la ejecución. El endpoint respeta los minutos configurados
por cada usuario y no reenvía un recordatorio ya marcado.

## 3. Frontend estático

- **Cloudflare Pages:** raíz del proyecto `frontend`, sin comando de build y
  directorio de salida `.`.
- **Netlify:** importá el proyecto; [`netlify.toml`](./netlify.toml) configura
  el directorio estático.

En [`frontend/config.js`](./frontend/config.js), `apiBaseUrl` usa
`http://localhost:3000` cuando la página se abre desde `localhost` o
`127.0.0.1`, y la URL HTTPS de Render en cualquier otro host. Verificá la URL de
Render antes de desplegar. Repetí exactamente el origen del frontend en
`CORS_ORIGIN` de Render y desplegá de nuevo. No agregues rutas ni una barra
final al origen CORS.

## Ejecución local

Copiá `.env.example` a `.env`, reemplazá todos los placeholders con valores
privados y completá `DATABASE_URL` y las contraseñas del seed. Instalá la
dependencia del backend y luego:

```sh
npm ci --prefix backend
npm run db:migrate
npm run db:seed
npm run dev
```

Abrí la URL que informa el servidor (por defecto, puerto 3000). Con el `.env`
de ejemplo, ambos comandos sirven frontend y API localmente; Render establece
`NODE_ENV=production` y solo expone la API.

## Backups y restauración

Desde el panel de administración, abrí **Backup** y seleccioná **Descargar
backup**. El JSON incluye todas las tablas de negocio y hashes de contraseñas;
tratá el archivo como dato sensible, guardalo en un lugar privado y no lo
subas a Git ni lo compartas.

Para restaurar, cargá el archivo en esa misma sección, revisá la fecha y los
conteos, descargá primero el backup actual y confirmá la contraseña vigente de
administrador junto con la frase exacta `RESTAURAR`. La operación reemplaza
todos los datos de negocio y se revierte por completo si falla. No se requieren
`pg_dump` ni `pg_restore`. Aplicá migraciones con `npm run db:migrate` antes
de usar esta función; backups de esquemas posteriores al actual se rechazan.
#