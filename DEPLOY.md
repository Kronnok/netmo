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
número de carro válido.

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

  Las cuentas nuevas se crean desde la sección **Usuarios** del panel de
  administración; no existe registro público. Desde **Inventario** se administran
  carros y altas consecutivas de notebooks.

Render publica la API y comprueba `/health`. Configurá `DATABASE_URL` y
`CORS_ORIGIN` como variables privadas del servicio; `JWT_SECRET` se genera en
Render a partir del manifiesto. Después de cambiar el esquema, volvé a ejecutar
`npm run db:migrate` desde un entorno seguro.

### Configurar correo

**Brevo:** verificá el remitente en Brevo, generá una API key y cargala como
`MAIL_API_KEY` en Render. Usá `MAIL_PROVIDER=brevo` y configurá
`MAIL_FROM_EMAIL` y `MAIL_FROM_NAME`.

**Google Apps Script:** creá un proyecto con una función `doPost` que lea el
JSON recibido (`secret`, `to`, `subject`, `html`), compare `secret` con un
secreto guardado en las propiedades del script, envíe con `MailApp.sendEmail`
y devuelva texto plano `ok`. Desplegalo como aplicación web ejecutada por tu
cuenta y accesible para recibir solicitudes; copiá su URL de implementación a
`MAIL_GAS_URL`, el mismo secreto a `MAIL_GAS_SECRET` y seleccioná
`MAIL_PROVIDER=gas`. La API sigue redirecciones y espera como máximo 15
segundos.

Render gratuito bloquea el SMTP saliente; por eso NetMO usa las APIs HTTPS de
Brevo o Apps Script en lugar de SMTP. No escribas claves ni secretos en el
repositorio. En desarrollo podés usar `MAIL_PROVIDER=console`; el correo de
prueba se envía con `npm run mail:test -- destino@correo.com`.

## 3. Frontend estático

- **Cloudflare Pages:** raíz del proyecto `frontend`, sin comando de build y
  directorio de salida `.`.
- **Netlify:** importá el proyecto; [`netlify.toml`](./netlify.toml) configura
  el directorio estático.

En [`frontend/config.js`](./frontend/config.js), establece `apiBaseUrl` con la
URL HTTPS del servicio Render. Repetí exactamente el origen del frontend en
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