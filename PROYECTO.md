# NetMO — descripción del sistema

## 1. Propósito

NetMO administra el inventario de notebooks de una institución educativa.
Permite a alumnos y profesores consultar disponibilidad, reservar equipos y registrar préstamos y devoluciones.
Los profesores pueden pedir lotes para un curso, sujetos a aprobación administrativa.
También permite reportar fallas, seguir tickets y registrar demoras de devolución.
Funciona como frontend web estático conectado a una API Node.js y a una base PostgreSQL.

## 2. Roles y permisos

Los permisos de la interfaz se presentan por rol, pero la autorización efectiva depende de las comprobaciones del backend.

| Rol | Permisos observados |
|---|---|
| `alumno` | Consultar inventario; administrar sus propias preferencias, reservas, préstamos y tickets; reservar una notebook por vez; solicitar devolución y reportar fallas. |
| `profesor` | Las funciones comunes; además, informar curso, reservar más de una notebook y solicitar lotes de al menos tres equipos. Los lotes requieren aprobación administrativa. |
| `admin` | Crear cuentas de alumnos y profesores; consultar y cambiar estados del inventario; administrar carros y notebooks; ver todas las reservas, aprobar lotes y registrar retiros; ver tickets y cambiar su estado; revisar devoluciones y demoras; banear usuarios con vencimiento. |

El seed contiene cuentas de ejemplo para instalaciones nuevas. No hay registro público: el administrador crea las cuentas nuevas de alumnos y profesores. Los usuarios existentes conservan sus credenciales y legajos.

## 3. Funcionalidades por módulo/pantalla

| Módulo o pantalla | Función |
|---|---|
| Acceso | Inicia sesión por correo y contraseña. La cuenta la crea un administrador. |
| Inicio | Muestra resumen/disponibilidad, actividad propia y accesos rápidos. Las normas y avisos son contenido informativo de la interfaz. |
| Mis préstamos | Muestra préstamos activos e historial; permite solicitar la devolución física para que administración la confirme. |
| Reservas | Crea reservas individuales o solicitudes de lote, muestra las propias y permite cancelar las que aún son cancelables. |
| Reportar falla / Mis tickets | Crea reportes asociados opcionalmente a una notebook y muestra el seguimiento propio. |
| Perfil | Muestra datos de cuenta y permite configurar preferencias de notificaciones por correo y minutos de recordatorio. Las preferencias se almacenan, pero no se implementa envío de correos ni ejecución de recordatorios. |
| Administración: Usuarios | Crea cuentas de alumno y profesor, consulta las listas reales y permite cambiar roles. |
| Administración: Inventario | Lista y filtra notebooks; administra carros y da de alta notebooks consecutivas por carro. |
| Administración: Devoluciones | Lista solicitudes pendientes y permite confirmar la recepción física. |
| Administración: Préstamos | Lista reservas individuales y por lote, permite aprobar o rechazar lotes y registrar retiros. |
| Administración: Fallas | Consulta tickets y cambia su estado; al resolverlos puede devolver el equipo a disponible. |
| Administración: Devoluciones tardías | Lista todos los alumnos y profesores con su total de tardanzas, permite banear por duración o desbanear y muestra el historial real. |
| Tema y sesión | Permite alternar tema claro/oscuro y cerrar la sesión local del navegador. El tema se guarda en `localStorage`. |

## 4. Flujos principales y reglas

### Login y cuentas

1. El login envía correo y contraseña a la API, que compara el hash almacenado; una cuenta baneada no puede iniciar sesión.
2. La API devuelve usuario y token de sesión; el frontend carga inventario, reservas, préstamos, tickets y preferencias.
3. El administrador crea nuevas cuentas; el backend valida nombre, apellido, legajo, correo, rol y contraseña, y genera preferencias iniciales.

No se valida que el dominio del correo sea institucional. La indicación de Gmail/correo institucional de la interfaz no constituye una regla del servidor.

### Reservas

1. El usuario autenticado elige fecha, horario, cantidad, motivo y, si es profesor, curso; para lote también indica cantidad y curso.
2. Solo se admiten fechas futuras del año actual, de lunes a viernes, entre 08:00–11:50 o 13:30–17:40, hora de Buenos Aires.
3. La cantidad debe ser de 1 a 40; alumnos solo pueden pedir una unidad. Un lote solo lo pide un profesor y debe tener al menos tres unidades; el curso es obligatorio para profesores.
4. No se aceptan nuevas solicitudes mientras el usuario tenga un préstamo abierto o una reserva en estados `confirmada`, `pendiente_aprobacion` o `aprobada`.
5. La API reserva equipos disponibles bajo transacción; si no alcanza la disponibilidad responde conflicto. La reserva individual queda `confirmada`; el lote queda `pendiente_aprobacion`.
6. El administrador puede aprobar el lote. No hay acción API para rechazarlo ni liberar equipos al rechazar.
7. El administrador registra el retiro. Se crea un préstamo por notebook, con vencimiento ocho horas después del retiro; la reserva pasa a `retirada`.
8. El propietario puede cancelar reservas `confirmada` o `pendiente_aprobacion`; no las ya aprobadas o retiradas.

Las reglas de año, día y horario usan `America/Argentina/Buenos_Aires` tanto en Node como en triggers de PostgreSQL. El vencimiento se fija ocho horas después del retiro y se presenta en esa zona horaria.

### Préstamos y devoluciones

1. El préstamo se crea al registrar el retiro de una reserva.
2. El usuario solicita la devolución de un préstamo activo; pasa a `devolucion_pendiente`, se registra una fila de devolución y la notebook a `pendiente_devolucion`.
3. Administración confirma la recepción; el préstamo pasa a `devuelto`, se libera el equipo y se actualiza su ubicación.
4. Un trigger registra la demora si la hora efectiva de devolución supera el vencimiento. Una vista cuenta tardanzas y marca candidato a sanción desde tres.

El cómputo de demora ocurre al confirmar la devolución, no al solicitarla. La interfaz presenta el umbral de tres como aviso para que administración evalúe una sanción; no hay sanción automática.

### Fallas y tickets

1. Un usuario autenticado envía motivo, descripción y, opcionalmente, notebook.
2. Si el equipo reportado está disponible, la API lo marca en mantenimiento.
3. Administración cambia el ticket entre `abierto`, `progreso` y `resuelto`; al resolverlo se completa quién/cuándo lo resolvió y, si el equipo estaba en mantenimiento, se vuelve a marcar disponible.

No se encuentra una regla de servidor que exija una notebook existente cuando se informa su código, ni validación de longitud para la descripción.

### Preferencias e inventario

Las preferencias admiten recordatorios de 0, 15, 30 o 60 minutos. El inventario permite estados `disponible`, `prestada`, `mantenimiento` y `pendiente_devolucion`. El cambio manual a `prestada` o `pendiente_devolucion` no asigna necesariamente `prestado_a`; la restricción de la tabla puede rechazarlo cuando no hay usuario asociado.

## 5. Arquitectura

```text
/
├── frontend/
│   ├── index.html        estructura y pantallas
│   ├── app.js            estado de interfaz y consumo de API
│   ├── config.js         URL base de API del frontend
│   └── styles.css        estilos y temas
├── backend/
│   ├── server.js         servidor HTTP, CORS y frontend local en desarrollo
│   ├── config.js         carga de configuración y variables de entorno
│   ├── routes.js         resolución de método, ruta y parámetros
│   ├── controllers/
│   │   └── api-controller.js lectura JSON, autenticación, despacho y respuestas
│   ├── services/
│   │   ├── auth-service.js login, tokens y autenticación
│   │   ├── session-token.js emisión y validación JWT HS256
│   │   ├── business-time.js reglas horarias de negocio
│   │   ├── login-rate-limiter.js límite de intentos de acceso
│   │   └── api-service.js reglas de negocio y consultas por acción
│   ├── data/
│   │   └── database.js   pool PostgreSQL y transacciones
│   ├── scripts/db.js     migración y carga inicial
│   └── test/             pruebas Node.js de servidor, seguridad y reglas
├── database/
│   ├── schema.sql        tablas, restricciones, funciones, triggers y vista
│   ├── seed.sql          cuentas, inventario y registros de ejemplo
│   ├── migrations/       migraciones SQL incrementales de negocio e inventario
│   └── scripts/          backup y su prueba de script
├── specs/                especificaciones de cambios existentes
├── reportes y cosas extra/ documentación y reportes históricos
├── README.md             requisitos y comandos
├── DEPLOY.md             guía de despliegue y backup
├── STACK.md              resumen del stack
├── render.yaml           definición del servicio API en Render
├── netlify.toml          publicación del frontend en Netlify
└── package.json          scripts npm de conveniencia de la raíz
```

Frontend: HTML, CSS y JavaScript nativo, sin framework. API: Node.js CommonJS, módulo HTTP nativo y `pg`, separada en rutas/controlador/servicios/persistencia. BDD: PostgreSQL 16. En desarrollo el backend sirve los archivos estáticos; en producción frontend y API se despliegan por separado. `node_modules/` es dependencia instalada, no código del sistema.

No se encontró `CONTEXT.md` en la raíz. La documentación de referencia `documentacion-netmo.txt` está bajo `reportes y cosas extra/`; los documentos históricos pueden no coincidir con el código actual.

## 6. API

Salvo health y login, las rutas requieren `Authorization: Bearer <token>`. Los endpoints `/api/admin/*` exigen rol administrador en el controlador y en sus acciones de servicio. Las respuestas de error tienen forma `{ "error": "..." }`. `/api/auth/register` no existe y responde 404.

| Método | Ruta | Rol requerido | Recibe | Devuelve |
|---|---|---|---|---|
| GET | `/health` | Ninguno | — | `{ok, service}` si puede consultar PostgreSQL. |
| POST | `/api/auth/login` | Público | `{email, password}` | `{token, user}`. |
| GET | `/api/me` | Autenticado | — | `{user}`. |
| GET | `/api/admin/professors` | Admin | — | `{professors}`. |
| GET | `/api/admin/users` | Admin | — | Usuarios no administradores en `{users}`. |
| GET | `/api/admin/users?rol=alumno\|profesor` | Admin | — | Filtra las cuentas por rol. |
| POST | `/api/admin/users` | Admin | `{nombre, apellido, email, legajo, rol, password}` | Crea cuenta y preferencias; HTTP 201. |
| GET | `/api/admin/carros` | Admin | — | `{carros}`. |
| POST | `/api/admin/carros` | Admin | `{numero}` | Crea un carro único entre 1 y 999; HTTP 201. |
| POST | `/api/admin/notebooks` | Admin | `{numero, carro_id, cantidad}` | Crea de 1 a 10 notebooks consecutivas; HTTP 201. |
| GET | `/api/preferences` | Autenticado | — | `{preferences}`. |
| PATCH | `/api/preferences` | Autenticado | `{email, recordatorio}` | `{preferences}`. |
| GET | `/api/notebooks` | Autenticado | — | `{notebooks}`. |
| PATCH | `/api/notebooks/:codigo` | Admin | `{estado}` | `{notebook}`. |
| GET | `/api/reservations` | Autenticado | — | Reservas propias en `{reservations}`. |
| POST | `/api/reservations` | Autenticado | `{tipo, cantidad, curso?, carro?, retiroAt, motivo?}` | `{reservation}`; HTTP 201. |
| DELETE | `/api/reservations/:codigo` | Autenticado; solo propietario | — | `{message}`. |
| GET | `/api/admin/reservations` | Admin | — | Todas las reservas en `{reservations}`. |
| POST | `/api/admin/reservations/:id/approve` | Admin | — | `{message}`. |
| POST | `/api/admin/reservations/:id/reject` | Admin | — | Rechaza lote pendiente/aprobado y libera notebooks; `{message}`. |
| POST | `/api/admin/reservations/:id/checkout` | Admin | — | `{message, loansCreated}`. |
| GET | `/api/loans` | Autenticado | — | Préstamos propios en `{loans}`. |
| POST | `/api/loans/:id/return` | Autenticado; solo propietario | — | `{message}`; HTTP 202. |
| GET | `/api/admin/returns` | Admin | — | Devoluciones pendientes en `{returns}`. |
| POST | `/api/admin/returns/:id/confirm` | Admin | — | `{message}`. |
| GET | `/api/tickets` | Autenticado | — | Tickets propios en `{tickets}`. |
| GET | `/api/admin/tickets` | Admin | — | Todos los tickets en `{tickets}`. |
| POST | `/api/tickets` | Autenticado | `{notebook?, motivo, descripcion}` | `{ticket}`; HTTP 201. |
| PATCH | `/api/tickets/:codigo` | Admin | `{estado}` | `{ticket}`. |
| GET | `/api/admin/late-returns` | Admin | — | Usuarios/resumen de tardanzas en `{users}` e historial en `{history}`. |
| PATCH | `/api/admin/users/:legajo` | Admin | `{baneado, duracionDias?}` | `{user}`; duración 1, 3, 7, 15, 30 días o indefinida; no modifica administradores. |
| PATCH | `/api/admin/users/:legajo/rol` | Admin | `{rol: alumno\|profesor}` | `{user}`; no modifica administradores. |

No hay paginación ni parámetros de consulta documentados en el router. Métodos CORS anunciados: `GET`, `POST`, `PATCH`, `DELETE` y `OPTIONS`.

## 7. Base de datos

PostgreSQL usa `citext` para emails y `pgcrypto` para hash de contraseñas. Las claves primarias son `BIGSERIAL`, salvo `user_preferences.user_id` y la clave compuesta de `reservation_notebooks`.

| Tabla | Columnas principales (tipo) y relaciones |
|---|---|
| `users` | `id BIGSERIAL PK`; `legajo VARCHAR(32) UNIQUE`; `nombre VARCHAR(120)`; `email CITEXT UNIQUE`; `rol user_role`; `password_hash TEXT`; `baneado BOOLEAN`; `baneado_hasta TIMESTAMPTZ nullable`; `created_at TIMESTAMPTZ`. |
| `user_preferences` | `user_id BIGINT PK/FK → users(id)`; `email_notifications BOOLEAN`; `return_reminder_minutes INTEGER` con valores permitidos 0/15/30/60; `updated_at TIMESTAMPTZ`. |
| `carros` | `numero INTEGER PK` entre 1 y 999; `created_at TIMESTAMPTZ`. |
| `notebooks` | `id BIGSERIAL PK`; `codigo VARCHAR(32) UNIQUE`; `estado notebook_status`; `ubicacion VARCHAR(80)`; `carro_id INTEGER nullable FK → carros(numero)`; `prestado_a BIGINT FK → users(id)`; `updated_at TIMESTAMPTZ`. Restricción de coherencia entre estado prestado/pendiente y usuario asignado. |
| `reservations` | `id BIGSERIAL PK`; `codigo VARCHAR(32) UNIQUE`; `owner_id BIGINT FK → users(id)`; `tipo reservation_type`; `carro VARCHAR(80)`; `curso VARCHAR(120)`; `cantidad INTEGER`; `retiro_at TIMESTAMPTZ`; `motivo TEXT`; `estado reservation_status`; `created_at TIMESTAMPTZ`. |
| `reservation_notebooks` | `reservation_id BIGINT FK → reservations(id)` y `notebook_id BIGINT FK → notebooks(id)` como PK compuesta; `active BOOLEAN`. Índice único parcial limita a una reserva activa por notebook. |
| `loans` | `id BIGSERIAL PK`; `notebook_id BIGINT FK → notebooks(id)`; `user_id BIGINT FK → users(id)`; `reservation_id BIGINT nullable FK → reservations(id)`; `curso VARCHAR(120)`; `retirada_at`, `vence_at`, `devuelta_at TIMESTAMPTZ`; `estado loan_status`. Índice único parcial por préstamo abierto y notebook. |
| `returns` | `id BIGSERIAL PK`; `loan_id BIGINT UNIQUE/FK → loans(id)`; `solicitado_at`, `confirmado_at TIMESTAMPTZ`; `confirmado_por BIGINT FK → users(id)`; `estado VARCHAR(24)` limitado a pendiente/confirmada. |
| `tickets` | `id BIGSERIAL PK`; `codigo VARCHAR(32) UNIQUE`; `notebook_id BIGINT nullable FK → notebooks(id)`; `owner_id BIGINT FK → users(id)`; `motivo VARCHAR(240)`; `descripcion TEXT`; `estado ticket_status`; `created_at`, `resolved_at TIMESTAMPTZ`; `resolved_by BIGINT nullable FK → users(id)`. |
| `late_returns` | `id BIGSERIAL PK`; `loan_id BIGINT UNIQUE/FK → loans(id)`; `user_id BIGINT FK → users(id)`; `notebook_id BIGINT FK → notebooks(id)`; `returned_at`, `due_at`, `created_at TIMESTAMPTZ`; exige devolución posterior al vencimiento. |
| `schema_migrations` | `version TEXT PK`; `applied_at TIMESTAMPTZ`. La crea el script de migraciones; no está declarada en `schema.sql`. |

Enums: `user_role` = alumno/profesor/admin; `notebook_status` = disponible/prestada/mantenimiento/pendiente_devolucion; `reservation_type` = individual/lote; `reservation_status` = confirmada/pendiente_aprobacion/aprobada/retirada/rechazada/cancelada; `loan_status` = activo/devolucion_pendiente/devuelto; `ticket_status` = abierto/progreso/resuelto.

La vista `user_late_return_summary` cuenta tardanzas y marca `candidato_a_sancion` desde tres, excluyendo administradores. Hay triggers para año, horario y fecha futura de reservas y para registrar devoluciones tardías.

## 8. Autenticación y seguridad

- Login compara la contraseña con `crypt()` y el hash PostgreSQL; las altas administrativas y el seed generan hash Blowfish mediante `gen_salt('bf')`.
- El token es JWT HS256 firmado con HMAC y `JWT_SECRET`, con vencimiento de 12 horas. En producción el secreto es obligatorio; Render lo genera. No hay almacenamiento persistente ni endpoint de revocación.
- El frontend mantiene el token solo en memoria; cerrar o recargar la página pierde la sesión. No conserva la contraseña en el objeto de usuario.
- CORS usa `CORS_ORIGIN`; acepta una lista de orígenes. En producción exige que la variable contenga al menos uno; en desarrollo, si no se indica, permite `*`.
- Se limita el cuerpo JSON a 1 MiB, se rechazan cuerpos no-objeto o JSON inválido y se usan consultas parametrizadas. El login limita cinco fallos por IP/correo durante 15 minutos y responde 429 al siguiente intento.
- Se envían `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`; las vistas escapan los valores dinámicos que interpolan en `innerHTML`.
- Las altas nuevas validan nombres Unicode, legajo numérico, email y contraseñas de al menos ocho caracteres sin espacios. Los baneos pueden tener duración o ser indefinidos y su expiración se aplica automáticamente al autenticar. El sistema no implementa recuperación de contraseña ni autenticación multifactor.

## 9. Configuración

Se indican solo nombres, sin valores. `backend/config.js` lee variables del entorno y, si existe, un `.env` en la raíz.

| Variable | Uso |
|---|---|
| `NODE_ENV` | Selecciona entorno; en producción limita CORS y desactiva servir el frontend desde la API. |
| `PORT` | Puerto HTTP de la API. |
| `DATABASE_URL` | Cadena de conexión PostgreSQL. |
| `CORS_ORIGIN` | Origen(es) del frontend permitido(s) por CORS. |
| `JWT_SECRET` | Secreto HMAC de los tokens; obligatorio en producción. |
| `NETMO_SEED_STUDENT_PASSWORD` | Contraseña inicial común para cuentas de alumno del seed. |
| `NETMO_SEED_TEACHER_PASSWORD` | Contraseña inicial de la cuenta de profesor del seed. |
| `NETMO_SEED_NETWORK_TEACHER_PASSWORD` | Contraseña inicial de la otra cuenta de profesor del seed. |
| `NETMO_SEED_ADMIN_PASSWORD` | Contraseña inicial de la cuenta administradora del seed. |
| `BACKUP_DIR` | Directorio de dumps. |
| `BACKUP_DATABASE` | Etiqueta del backup en los mensajes del script. |
| `BACKUP_INTERVAL_SECONDS` | Intervalo entre backups en modo continuo. |
| `BACKUP_TIMEZONE` | Zona horaria usada para fechar el backup. |
| `BACKUP_ONCE` | Ejecuta un backup puntual cuando vale `1`. |
| `BACKUP_CONNECTION_RETRIES` | Cantidad de intentos de conexión para crear el dump. |
| `BACKUP_RETRY_DELAY_SECONDS` | Pausa entre intentos. |
| `BACKUP_LOCK_DIR` | Directorio de bloqueo contra ejecuciones simultáneas. |
| `BACKUP_LOCK_MAX_AGE_SECONDS` | Antigüedad para considerar abandonado un bloqueo. |

La URL base del frontend se configura en `frontend/config.js`, no mediante una variable de entorno del navegador.

## 10. Deploy actual descrito por el repositorio

- **Frontend:** estático en Cloudflare Pages o Netlify. Netlify usa `netlify.toml`; Pages requiere configurar la carpeta `frontend` según `DEPLOY.md`.
- **API:** servicio Node en Render definido en `render.yaml`, con comprobación `/health`; Render genera `JWT_SECRET`, y `DATABASE_URL` y `CORS_ORIGIN` se configuran como variables privadas.
- **BDD:** PostgreSQL 16 en Neon según `README.md` y `DEPLOY.md`; el servicio de Render se conecta por `DATABASE_URL`. Migración y seed se ejecutan manualmente desde un entorno preparado.
- **Desarrollo:** `npm run dev` inicia la API y sirve el frontend local; los scripts raíz delegan en `backend/`.
- **Backups:** `database/scripts/backup-loop.sh` es una herramienta opcional que crea dumps custom, valida con `pg_restore`, reintenta y conserva hasta 30 copias fechadas. Puede ejecutarse puntualmente o en bucle, pero no hay servicio de backup ni programación automática declarados en `render.yaml`.

Los manifiestos y documentos describen el destino previsto; el estado operativo real de las plataformas externas no se puede determinar solo desde el repositorio.

## 11. Estado, limitaciones y mejoras recomendadas

### Funciona según el código

- Rutas API implementadas para autenticación, reservas, retiros, devoluciones, inventario, tickets, preferencias y administración.
- Controles de disponibilidad, estado y reglas temporales en backend y restricciones/triggers de PostgreSQL.
- Migración inicial, migración SQL versionada y seed idempotente con contraseñas externas.
- Pruebas automatizadas del servidor/rutas y prueba del script de backup.

### Incompleto o deuda detectada

1. **Sesiones:** los tokens expiran a las 12 horas, pero no hay endpoint de revocación ni almacenamiento persistente de sesiones.
2. **Acciones no disponibles:** los cambios manuales de inventario están limitados a disponible/mantenimiento.
3. **Notificaciones:** preferencias de correo/recordatorio se guardan, pero no existe envío ni ejecución de recordatorios.
4. **Validación/interfaz:** el correo se valida por formato, no por dominio institucional.
5. **Pruebas:** las pruebas API no cubren flujos contra PostgreSQL real; las pruebas de backup usan herramientas simuladas.
6. **Documentación:** no existe `CONTEXT.md` en raíz; el estado operativo real de servicios externos no se puede determinar desde el repositorio.

### Mejoras recomendadas

- Añadir revocación explícita de tokens y renovar/invalidar sesión de manera controlada.
- Completar las validaciones del formulario de fallas y de dominios de correo si la política institucional lo requiere.
- Implementar el servicio real de notificaciones y configurar una estrategia de backup automatizada y verificada en el entorno operativo.
- Añadir pruebas de integración contra PostgreSQL.
