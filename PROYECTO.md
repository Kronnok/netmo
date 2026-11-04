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
| `alumno` | Consultar inventario; administrar sus preferencias, reservas, préstamos y tickets; reservar una notebook por vez; reportar fallas y responder sus tickets. |
| `profesor` | Las funciones comunes; además, informar curso, reservar más de una notebook y solicitar lotes de al menos tres equipos. Los lotes requieren aprobación administrativa. |
| `admin` | Crear cuentas; administrar roles, carros, ubicaciones y notebooks; ver reservas y préstamos, registrar entregas y devoluciones; administrar tickets y respuestas; revisar demoras y banear usuarios con vencimiento. |

El seed contiene cuentas de ejemplo para instalaciones nuevas. No hay registro público: el administrador crea las cuentas nuevas de alumnos y profesores. Los usuarios existentes conservan sus credenciales y los valores de su DNI; el DNI solo se muestra al propio usuario y a administración.

## 3. Funcionalidades por módulo/pantalla

| Módulo o pantalla | Función |
|---|---|
| Acceso | Inicia sesión por correo y contraseña. La cuenta la crea un administrador. |
| Inicio | Muestra resumen/disponibilidad, actividad propia y accesos rápidos. Las normas y avisos son contenido informativo de la interfaz. |
| Mis préstamos | Muestra préstamos activos, historial, hora de vencimiento, cuenta regresiva y avisos previos; la devolución la registra administración. |
| Reservas | Crea reservas individuales o solicitudes de lote filtrando equipos por ubicación del carro, muestra las propias y permite cancelar las que aún son cancelables. |
| Reportar falla / Mis tickets | Crea reportes asociados a notebooks del historial propio o a “Otra / no sé”; muestra el seguimiento y el hilo de respuestas. |
| Perfil | Muestra los datos de cuenta y permite configurar notificaciones por correo y minutos de recordatorio (0 desactiva el aviso). |
| Administración: Usuarios | Crea cuentas de alumno y profesor, consulta las listas reales, permite cambiar roles y banear cuentas. |
| Administración: Inventario | Lista y filtra notebooks; administra carros y ubicaciones editables, renumera carros y da de alta o mueve notebooks. |
| Administración: Entregas y devoluciones | Busca usuarios y préstamos activos, registra devoluciones individuales o de un lote y actualiza la lista periódicamente. |
| Administración: Préstamos | Lista reservas individuales y por lote, permite aprobar lotes y registrar entrega; notebooks disponibles pueden asignarse al entregar. |
| Administración: Fallas | Consulta tickets, cambia su estado y responde; notebooks prestadas con tickets abiertos vuelven a mantenimiento al devolverse. |
| Administración: Devoluciones tardías | Lista todos los alumnos y profesores con su total de tardanzas, permite banear por duración o desbanear y muestra el historial real. |
| Tema y sesión | Permite alternar tema claro/oscuro, elegir si se mantiene la sesión y cerrar sesión. El tema se guarda en `localStorage`; los tokens se guardan en `localStorage` solo si el usuario elige mantener la sesión, o en `sessionStorage` en caso contrario. |

## 4. Flujos principales y reglas

### Login y cuentas

1. Al abrir la página, el frontend calienta `/health`; si encuentra un token, valida/restaura la sesión con `GET /api/me` y, si vence en menos de dos horas, lo renueva.
2. El login envía correo y contraseña a la API, que compara el hash almacenado en una consulta; una cuenta baneada no puede iniciar sesión.
3. La API devuelve usuario y token; los datos necesarios para el rol y la vista se cargan en paralelo. La contraseña nunca se almacena en el navegador.
4. El administrador crea nuevas cuentas; el backend valida nombre, apellido, DNI de 7 a 10 dígitos, correo, rol y contraseña, y genera preferencias iniciales.
5. El administrador puede cambiar el rol de otra cuenta, pero no el propio; no puede dejar el sistema sin administradores y debe confirmar su contraseña para ascender una cuenta. El rol vigente se consulta desde la base en cada solicitud.

No se valida que el dominio del correo sea institucional. La indicación de Gmail/correo institucional de la interfaz no constituye una regla del servidor.

### Reservas

1. El usuario autenticado elige fecha, horario, ubicación (o todas), carro disponible, cantidad, motivo y, si es profesor, curso; para lote también indica cantidad y curso. Los carros se filtran por ubicación y muestran las unidades disponibles.
2. Solo se admiten fechas futuras del año actual, de lunes a viernes, entre 08:00–11:50 o 13:30–17:40, hora de Buenos Aires.
3. La cantidad debe ser de 1 a 40; alumnos solo pueden pedir una unidad. Un lote solo lo pide un profesor y debe tener al menos tres unidades; el curso es obligatorio para profesores.
4. No se aceptan nuevas solicitudes mientras el usuario tenga un préstamo abierto o una reserva en estados `confirmada`, `pendiente_aprobacion` o `aprobada`.
5. La API reserva equipos disponibles bajo transacción; si no alcanza la disponibilidad responde conflicto. La reserva individual queda `confirmada`; el lote queda `pendiente_aprobacion`.
6. El administrador puede aprobar el lote. No hay acción API para rechazarlo ni liberar equipos al rechazar.
7. El administrador registra el retiro. Se crea un préstamo por notebook, con vencimiento ocho horas después del retiro; la reserva pasa a `retirada`.
8. El propietario puede cancelar reservas `confirmada` o `pendiente_aprobacion`; no las ya aprobadas o retiradas.

Las reglas de año, día y horario usan `America/Argentina/Buenos_Aires` tanto en Node como en triggers de PostgreSQL. El vencimiento se fija ocho horas después del retiro y se presenta en esa zona horaria.

### Préstamos y devoluciones

1. El préstamo se crea al registrar la entrega de una reserva; los lotes pendientes se pueden aprobar y entregar en una transacción.
2. El usuario solo consulta el préstamo, vencimiento y cuenta regresiva; no inicia una devolución.
3. Administración registra la recepción directamente. El préstamo pasa a `devuelto`; la notebook queda en mantenimiento si tiene un ticket abierto o en progreso, o disponible en caso contrario.
4. Un trigger registra la demora si la hora efectiva de devolución supera el vencimiento. Una vista cuenta tardanzas y marca candidato a sanción desde tres.

El cómputo de demora ocurre al confirmar la devolución, no al solicitarla. La interfaz presenta el umbral de tres como aviso para que administración evalúe una sanción; no hay sanción automática.

### Fallas y tickets

1. Un usuario autenticado envía motivo, descripción y una notebook del historial propio, o elige “Otra / no sé”.
2. Si el equipo reportado está disponible, la API lo marca en mantenimiento; si está prestado, la devolución lo pondrá en mantenimiento mientras haya tickets activos.
3. Administración cambia el ticket entre `abierto`, `progreso` y `resuelto`; resolver el último ticket activo devuelve a disponible un equipo que esté en mantenimiento. El dueño y administración pueden mantener un hilo de respuestas; una respuesta del dueño reabre el ticket.

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
| POST | `/api/auth/refresh` | Autenticado | — | `{token}`; renueva la sesión próxima a vencer. |
| GET | `/api/me` | Autenticado | — | `{user}`. |
| GET | `/api/admin/professors` | Admin | — | `{professors}`. |
| GET | `/api/admin/users` | Admin | — | Usuarios de todos los roles en `{users}`. |
| GET | `/api/admin/users?rol=alumno\|profesor\|admin` | Admin | — | Filtra las cuentas por rol. |
| POST | `/api/admin/users` | Admin | `{nombre, apellido, email, dni, rol, password}` | Crea cuenta y preferencias; HTTP 201. |
| PATCH | `/api/admin/users/:dni` | Admin | `{baneado, duracionDias?}` | `{user}`; duración 1, 3, 7, 15, 30 días o indefinida; no modifica administradores. |
| PATCH | `/api/admin/users/:dni/rol` | Admin | `{rol, password?}` | `{user}`; no permite cambiar el propio rol ni eliminar el último admin; al ascender exige contraseña. |
| GET | `/api/carros` | Autenticado | — | `{carros}` con `numero`, `ubicacion`, `total` y `disponibles`. |
| GET | `/api/admin/ubicaciones` | Admin | — | `{ubicaciones}`. |
| POST | `/api/admin/ubicaciones` | Admin | `{nombre}` | Crea una ubicación con slug único; HTTP 201. |
| PATCH | `/api/admin/ubicaciones/:slug` | Admin | `{nombre}` | Renombra la ubicación. |
| DELETE | `/api/admin/ubicaciones/:slug` | Admin | — | Elimina si ningún carro la usa; HTTP 409 si está en uso. |
| GET | `/api/admin/carros` | Admin | — | `{carros}`. |
| POST | `/api/admin/carros` | Admin | `{numero}` | Crea un carro único entre 1 y 999; HTTP 201. |
| PATCH | `/api/admin/carros/:numero` | Admin | `{numero?, ubicacion?}` | Actualiza ubicación o renumera; HTTP 200. |
| DELETE | `/api/admin/carros/:numero` | Admin | — | Elimina solo si no contiene notebooks; HTTP 409 si tiene. |
| POST | `/api/admin/notebooks` | Admin | `{numero, carro_id, cantidad}` | Crea de 1 a 10 notebooks consecutivas; HTTP 201. |
| GET | `/api/preferences` | Autenticado | — | `{preferences}`. |
| PATCH | `/api/preferences` | Autenticado | `{email, recordatorio}` | `{preferences}`. |
| GET | `/api/notebooks` | Autenticado | — | `{notebooks}`. |
| PATCH | `/api/notebooks/:codigo` | Admin | `{estado?, carro?}` | `{notebook}`; permite cambiar estado o moverla a otro carro. |
| GET | `/api/reservations` | Autenticado | — | Reservas propias en `{reservations}`. |
| POST | `/api/reservations` | Autenticado | `{tipo, cantidad, curso?, carro?, ubicacion?, retiroAt, motivo?}` | `{reservation}`; valida que el carro corresponda a la ubicación; HTTP 201. |
| DELETE | `/api/reservations/:codigo` | Autenticado; solo propietario | — | `{message}`. |
| GET | `/api/admin/reservations` | Admin | — | Todas las reservas en `{reservations}`. |
| GET | `/api/admin/reservations?q=texto` | Admin | — | Reservas pendientes de entrega coincidentes; hasta 50 resultados. |
| POST | `/api/admin/reservations/:id/approve` | Admin | — | `{message}`. |
| POST | `/api/admin/reservations/:id/reject` | Admin | — | Rechaza lote pendiente/aprobado y libera notebooks; `{message}`. |
| POST | `/api/admin/reservations/:id/checkout` | Admin | — | `{message, loansCreated}`. |
| POST | `/api/admin/reservations/:id/approve-checkout` | Admin | — | Aprueba y entrega un lote en una transacción. |
| GET | `/api/loans` | Autenticado | — | Préstamos propios en `{loans}`. |
| POST | `/api/loans/:id/return` | Autenticado; solo propietario | — | Compatibilidad con clientes anteriores; no se usa en la interfaz. |
| GET | `/api/admin/loans?q=texto&estado=activo` | Admin | — | Préstamos coincidentes, hasta 50; incluye si está vencido. |
| POST | `/api/admin/loans/:id/return` | Admin | — | Registra una devolución directa. |
| POST | `/api/admin/loans/return` | Admin | `{loanIds}` | Registra en una transacción la devolución de varias notebooks de una persona. |
| GET | `/api/admin/returns` | Admin | — | Devoluciones pendientes en `{returns}`. |
| POST | `/api/admin/returns/:id/confirm` | Admin | — | `{message}`. |
| GET | `/api/tickets` | Autenticado | — | Tickets propios en `{tickets}`. |
| GET | `/api/tickets/notebooks` | Autenticado | — | Notebooks del historial propio, ordenadas por último uso. |
| GET | `/api/admin/tickets` | Admin | — | Todos los tickets en `{tickets}`. |
| POST | `/api/tickets` | Autenticado | `{notebook?, motivo, descripcion}` | `{ticket}`; HTTP 201. |
| GET | `/api/tickets/:codigo/replies` | Dueño del ticket o admin | — | Hilo de respuestas. |
| POST | `/api/tickets/:codigo/replies` | Dueño del ticket o admin | `{mensaje}` | Agrega una respuesta de hasta 500 caracteres. |
| PATCH | `/api/tickets/:codigo` | Admin | `{estado}` | `{ticket}`. |
| POST | `/api/internal/reminders` | Cron con `x-cron-secret` | — | Envía recordatorios pendientes de vencimiento; idempotente. |
| GET | `/api/admin/late-returns` | Admin | — | Usuarios/resumen de tardanzas en `{users}` e historial en `{history}`. |
Las búsquedas administrativas aceptan hasta 50 caracteres y devuelven un máximo de 50 resultados. Métodos CORS anunciados: `GET`, `POST`, `PATCH`, `DELETE` y `OPTIONS`.

## 7. Base de datos

PostgreSQL usa `citext` para emails y `pgcrypto` para hash de contraseñas. Las claves primarias son `BIGSERIAL`, salvo `user_preferences.user_id` y la clave compuesta de `reservation_notebooks`.

| Tabla | Columnas principales (tipo) y relaciones |
|---|---|
| `users` | `id BIGSERIAL PK`; `dni VARCHAR(32) UNIQUE`; `nombre VARCHAR(120)`; `email CITEXT UNIQUE`; `rol user_role`; `password_hash TEXT`; `baneado BOOLEAN`; `baneado_hasta TIMESTAMPTZ nullable`; `created_at TIMESTAMPTZ`. |
| `user_preferences` | `user_id BIGINT PK/FK → users(id)`; `email_notifications BOOLEAN`; `return_reminder_minutes INTEGER` con valores permitidos 0/15/30/60; `updated_at TIMESTAMPTZ`. |
| `ubicaciones` | `slug VARCHAR(32) PK`; `nombre VARCHAR(50)`; catálogo editable con las ubicaciones iniciales. |
| `carros` | `numero INTEGER PK` entre 1 y 999; `ubicacion VARCHAR(20) nullable FK → ubicaciones(slug)`; `created_at TIMESTAMPTZ`. |
| `notebooks` | `id BIGSERIAL PK`; `codigo VARCHAR(32) UNIQUE`; `estado notebook_status`; `ubicacion VARCHAR(80)`; `carro_id INTEGER nullable FK → carros(numero)`; `prestado_a BIGINT FK → users(id)`; `updated_at TIMESTAMPTZ`. Restricción de coherencia entre estado prestado/pendiente y usuario asignado. |
| `reservations` | `id BIGSERIAL PK`; `codigo VARCHAR(32) UNIQUE`; `owner_id BIGINT FK → users(id)`; `tipo reservation_type`; `carro VARCHAR(80)`; `curso VARCHAR(120)`; `cantidad INTEGER`; `retiro_at TIMESTAMPTZ`; `motivo TEXT`; `estado reservation_status`; `created_at TIMESTAMPTZ`. |
| `reservation_notebooks` | `reservation_id BIGINT FK → reservations(id)` y `notebook_id BIGINT FK → notebooks(id)` como PK compuesta; `active BOOLEAN`. Índice único parcial limita a una reserva activa por notebook. |
| `loans` | `id BIGSERIAL PK`; `notebook_id BIGINT FK → notebooks(id)`; `user_id BIGINT FK → users(id)`; `reservation_id BIGINT nullable FK → reservations(id)`; `curso VARCHAR(120)`; `retirada_at`, `vence_at`, `devuelta_at`, `reminder_sent_at TIMESTAMPTZ`; `estado loan_status`. Índice único parcial por préstamo abierto y notebook. |
| `returns` | `id BIGSERIAL PK`; `loan_id BIGINT UNIQUE/FK → loans(id)`; `solicitado_at`, `confirmado_at TIMESTAMPTZ`; `confirmado_por BIGINT FK → users(id)`; `estado VARCHAR(24)` limitado a pendiente/confirmada. |
| `tickets` | `id BIGSERIAL PK`; `codigo VARCHAR(32) UNIQUE`; `notebook_id BIGINT nullable FK → notebooks(id)`; `owner_id BIGINT FK → users(id)`; `motivo VARCHAR(240)`; `descripcion TEXT`; `estado ticket_status`; `created_at`, `resolved_at TIMESTAMPTZ`; `resolved_by BIGINT nullable FK → users(id)`. |
| `ticket_replies` | `id BIGSERIAL PK`; `ticket_id BIGINT FK → tickets(id)`; `author_id BIGINT FK → users(id)`; `mensaje VARCHAR(500)`; `created_at TIMESTAMPTZ`. |
| `late_returns` | `id BIGSERIAL PK`; `loan_id BIGINT UNIQUE/FK → loans(id)`; `user_id BIGINT FK → users(id)`; `notebook_id BIGINT FK → notebooks(id)`; `returned_at`, `due_at`, `created_at TIMESTAMPTZ`; exige devolución posterior al vencimiento. |
| `schema_migrations` | `version TEXT PK`; `applied_at TIMESTAMPTZ`. La crea el script de migraciones; no está declarada en `schema.sql`. |

Enums: `user_role` = alumno/profesor/admin; `notebook_status` = disponible/prestada/mantenimiento/pendiente_devolucion; `reservation_type` = individual/lote; `reservation_status` = confirmada/pendiente_aprobacion/aprobada/retirada/rechazada/cancelada; `loan_status` = activo/devolucion_pendiente/devuelto; `ticket_status` = abierto/progreso/resuelto.

La vista `user_late_return_summary` cuenta tardanzas y marca `candidato_a_sancion` desde tres, excluyendo administradores. Hay triggers para año, horario y fecha futura de reservas y para registrar devoluciones tardías.

## 8. Autenticación y seguridad

- Login compara la contraseña con `crypt()` y el hash PostgreSQL; las altas administrativas y el seed generan hash Blowfish mediante `gen_salt('bf')`.
- El token es JWT HS256 firmado con HMAC y `JWT_SECRET`, con vencimiento de 12 horas. En producción el secreto es obligatorio; Render lo genera. El endpoint de refresh emite un token nuevo para sesiones próximas a vencer.
- El frontend persiste solo el token, en `localStorage` si se solicita mantener la sesión y en `sessionStorage` en caso contrario. Al iniciar, valida el token mediante `/api/me`; no almacena la contraseña.
- CORS usa `CORS_ORIGIN`; acepta una lista de orígenes. En producción exige que la variable contenga al menos uno; en desarrollo, si no se indica, permite `*`.
- Se limita el cuerpo JSON a 1 MiB, se rechazan cuerpos no-objeto o JSON inválido y se usan consultas parametrizadas. El login limita cinco fallos por IP/correo durante dos minutos por defecto; `LOGIN_LOCK_MINUTES` permite configurar la ventana con mínimo de un minuto.
- Se envían `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`; las vistas escapan los valores dinámicos que interpolan en `innerHTML`.
- Las altas nuevas validan nombres Unicode, DNI numérico de 7 a 10 dígitos, email y contraseñas de al menos ocho caracteres sin espacios. Los DNI de cuentas existentes no se revalidan ni modifican. El DNI solo se devuelve al propio usuario y a administradores; no se incluye en logs. Los baneos pueden tener duración o ser indefinidos y su expiración se aplica automáticamente al autenticar. La recuperación de contraseña usa códigos de un solo uso; no hay autenticación multifactor.

## 9. Configuración

Se indican solo nombres, sin valores. `backend/config.js` lee variables del entorno y, si existe, un `.env` en la raíz.

| Variable | Uso |
|---|---|
| `NODE_ENV` | Selecciona entorno; en producción limita CORS y desactiva servir el frontend desde la API. |
| `PORT` | Puerto HTTP de la API. |
| `DATABASE_URL` | Cadena de conexión PostgreSQL. |
| `CORS_ORIGIN` | Origen(es) del frontend permitido(s) por CORS. |
| `JWT_SECRET` | Secreto HMAC de los tokens; obligatorio en producción. |
| `LOGIN_LOCK_MINUTES` | Duración del bloqueo de login; mínimo 1 minuto y predeterminado 2. |
| `CRON_SECRET` | Secreto obligatorio en producción para autenticar `/api/internal/reminders`. |
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
- Sesión persistente opcional, restauración con `/api/me` y renovación de tokens; DNI, administración de roles y ubicaciones/filtros de carros.
- Controles de disponibilidad, estado y reglas temporales en backend y restricciones/triggers de PostgreSQL.
- Migración inicial, migración SQL versionada y seed idempotente con contraseñas externas.
- Pruebas automatizadas del servidor/rutas y prueba del script de backup.

### Incompleto o deuda detectada

1. **Sesiones:** no existe revocación individual del token antes de su vencimiento; la sesión se conserva en el navegador según la preferencia del usuario.
2. **Acciones no disponibles:** los cambios manuales de inventario no incluyen cambios arbitrarios de estado; se administran ubicación y carro.
3. **Notificaciones:** preferencias de correo/recordatorio se guardan, pero no existe envío ni ejecución de recordatorios.
4. **Validación/interfaz:** el correo se valida por formato, no por dominio institucional.
5. **Pruebas:** las pruebas API no cubren flujos contra PostgreSQL real; las pruebas de backup usan herramientas simuladas.
6. **Documentación:** no existe `CONTEXT.md` en raíz; el estado operativo real de servicios externos no se puede determinar desde el repositorio.

### Mejoras recomendadas

- Añadir revocación explícita de tokens antes de su vencimiento, si se requiere control de sesiones por dispositivo.
- Completar las validaciones del formulario de fallas y de dominios de correo si la política institucional lo requiere.
- Implementar el servicio real de notificaciones y configurar una estrategia de backup automatizada y verificada en el entorno operativo.
- Añadir pruebas de integración contra PostgreSQL.
