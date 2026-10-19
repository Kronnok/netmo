 Deploy gratuito

NetMO se despliega sin Docker ni Nginx: Neon aloja PostgreSQL, Render ejecuta la
API y Cloudflare Pages o Netlify sirve el frontend estático.

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

## 2. API en Render

Importá el repositorio en Render usando [render.yaml](./render.yaml). En el
servicio completá:

- `DATABASE_URL`: cadena de Neon con `sslmode=require`.
- `CORS_ORIGIN`: origen exacto de Pages o Netlify (sin rutas), por ejemplo
  `https://netmo.pages.dev`.

Render publica la API y comprueba `/health`. Configurá `DATABASE_URL` y
`CORS_ORIGIN` como variables privadas del servicio. Después de cambiar el
esquema, volvé a ejecutar `npm run db:migrate` desde un entorno seguro.

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

El backup es opcional y requiere `pg_dump`/`pg_restore` instalados. Desde Git
Bash, con `DATABASE_URL` y `BACKUP_ONCE=1`, ejecutá
`sh database/scripts/backup-loop.sh`. Para restaurar un dump custom, verificá
el destino y ejecutá:

```sh
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" backup.dump
```

`--clean` reemplaza objetos; primero probá la restauración en una base vacía.
#