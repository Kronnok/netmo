# NetMO

Sistema web para gestionar préstamos, reservas y mantenimiento de notebooks.
El frontend es HTML, CSS y JavaScript nativo; la API usa Node.js CommonJS y HTTP
nativo, organizada en rutas, controladores, servicios y acceso a datos. La
persistencia es PostgreSQL 16.

## Requisitos

- Node.js 22 o superior.
- PostgreSQL 16 accesible mediante `DATABASE_URL`.
- `pg_dump` y `pg_restore` solo si se usan las copias de seguridad opcionales.

## Desarrollo local

1. Copiá `.env.example` a `.env` y completá la URL de PostgreSQL y las cuatro
   contraseñas privadas requeridas por el seed.
2. Instalá y prepará la base:

   ```sh
   npm ci --prefix backend
   npm run db:migrate
   npm run db:seed
   ```

3. Iniciá la API y el frontend:

   ```sh
   npm run dev
   ```

   El servidor usa el puerto `3000` por defecto. La configuración de frontend
   está en `frontend/config.js`; el modo demo se activa únicamente al establecer
   `apiBaseUrl: null`.

## Despliegue

Render aloja la API y Neon PostgreSQL; Cloudflare Pages o Netlify sirven el
frontend estático. Consultá [DEPLOY.md](./DEPLOY.md) para configurar las
variables, los orígenes CORS y las plataformas.

## Base de datos

El esquema, las migraciones y los datos iniciales se encuentran en `database/`.
`npm run db:seed` registra la aplicación del seed para evitar ejecutarlo una
segunda vez. Las credenciales se suministran mediante variables de entorno y no
deben guardarse en el repositorio.
