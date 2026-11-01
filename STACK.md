# Stack tecnológico de NetMO

| Capa | Tecnología |
| --- | --- |
| Frontend | HTML5, CSS3 y JavaScript nativo, en `frontend/` |
| API | Node.js 22, HTTP nativo, organizada en rutas, controladores, servicios y acceso a datos |
| Driver de datos | `pg` (node-postgres) con `Pool` |
| BDD | PostgreSQL 16; esquema, migraciones y seed SQL en `database/` |
| Configuración | Variables de entorno, archivo `.env` local y `.env.example`; `JWT_SECRET` firma tokens HMAC de 12 horas y es obligatorio en producción |
| Deploy | Frontend Cloudflare Pages o Netlify; API Render; BDD Neon |
| Operaciones | Scripts shell opcionales para backups con `pg_dump` |

El frontend usa JavaScript nativo y la API usa el módulo HTTP de Node.js.
Durante el desarrollo, Node sirve el frontend estático junto con la API; en
producción se publica por separado y se conecta a la API mediante CORS.
`database/migrations/002-business-timezone.sql` fija en PostgreSQL las reglas de
reservas a `America/Argentina/Buenos_Aires`. Consultá [DEPLOY.md](./DEPLOY.md).
