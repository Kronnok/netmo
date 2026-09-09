# Contexto de ingeniería de NetMO

Este documento resume la arquitectura existente para orientar el trabajo basado
en especificaciones. No sustituye a una especificación de cambio (`.spec.md`).

## Arquitectura

- **Frontend:** `index.html` contiene el HTML, el CSS y el JavaScript vanilla de la interfaz. Incluye los flujos de autenticación demo, vistas por rol, inventario, reservas, préstamos, devoluciones, tickets, preferencias y temas claro/oscuro.
- **Backend:** `backend/server.js` expone una API HTTP con el módulo nativo `node:http`. No hay framework web ni sistema de rutas externo.
- **Persistencia:** PostgreSQL se conecta mediante `pg` y un `Pool`. La configuración se obtiene de variables de entorno como `DB_HOST`, `DB_PORT`, `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`.
- **Infraestructura:** `backend/Dockerfile`, `database/Dockerfile` y `database/docker-compose.yml` contienen la configuración de contenedores. El proyecto no tiene un pipeline de frontend ni un bundler identificado.

## Stack detectado

- HTML, CSS y JavaScript sin framework en el frontend.
- Node.js CommonJS en el backend.
- API HTTP y JSON.
- PostgreSQL con `pg`, `citext` y `pgcrypto`.
- Docker para la base de datos y servicios asociados.

## Modelo de datos

`database/schema.sql` define:

- `users`, `user_preferences` y los roles `alumno`, `profesor` y `admin`.
- `notebooks` y los estados `disponible`, `prestada`, `mantenimiento` y `pendiente_devolucion`.
- `reservations`, `reservation_notebooks` y sus tipos/estados.
- `loans`, `returns`, `late_returns` y `user_late_return_summary`.
- `tickets` y sus estados `abierto`, `progreso` y `resuelto`.
- Restricciones, índices, triggers y funciones para disponibilidad, horarios, año de reserva y devoluciones tardías.

Los datos de desarrollo están en `database/seed.sql`.

## API y reglas observadas

- `GET /health` comprueba la conexión con PostgreSQL.
- La autenticación usa `POST /api/auth/login` y sesiones en memoria del proceso; el cliente recibe un token Bearer.
- `GET /api/me` y `GET/PATCH /api/preferences` gestionan el usuario y sus preferencias.
- `GET/PATCH /api/notebooks` consulta o cambia inventario; el cambio de estado requiere rol `admin`.
- `GET/POST/DELETE /api/reservations` gestiona reservas propias; existen endpoints administrativos para consultar y aprobar lotes.
- `GET /api/loans` y el endpoint de devolución gestionan préstamos del usuario; administración confirma devoluciones.
- También existen endpoints para tickets, usuarios, tardanzas y operaciones administrativas en `backend/server.js`.
- Las reservas validan año actual, días y horarios permitidos, cantidad, rol, curso y ausencia de entregas o reservas pendientes.
- Los alumnos solo pueden solicitar una notebook; los profesores pueden solicitar lotes bajo las reglas del backend.

## Convenciones detectadas

- Mensajes y nombres funcionales dirigidos al usuario están en español.
- Las respuestas de API son JSON y usan `{ error: ... }` para errores puntuales.
- Las consultas SQL están dentro de `backend/server.js` y usan parámetros posicionales.
- Las operaciones que asignan varios equipos utilizan transacciones y bloqueos de PostgreSQL.
- El frontend conserva un modo demo y puede funcionar sin depender de la API, según la documentación existente.
- La documentación operativa está en archivos `.txt` en la raíz y debe contrastarse con el código ejecutable.

## Validación disponible

- `backend/package.json` solo define el script `npm start`; no se detectaron scripts de test, lint o typecheck.
- Para cambios de API o base de datos, la validación mínima debe incluir revisión de sintaxis y, cuando el entorno esté levantado, `GET /health` y pruebas del endpoint afectado.
- Para cambios de frontend, comprobar los flujos afectados en un navegador y verificar los estados de cada rol descritos en la especificación.

## Riesgos y límites conocidos

- Las sesiones viven en memoria y se pierden al reiniciar el backend.
- La interfaz demo y la API pueden divergir; toda migración de un flujo debe especificar cuál es la fuente de verdad.
- No deben hacerse cambios de esquema sin especificar migración, seed, compatibilidad y recuperación ante fallo.
- El código existente puede contener incidencias históricas documentadas; no corregirlas incidentalmente fuera del alcance aprobado.