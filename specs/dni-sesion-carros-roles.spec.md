# Especificación: DNI, sesiones, ubicación de carros y roles

## Estado

Aprobada para implementación según el pedido del propietario y las respuestas
de esta sesión. El pedido es la fuente de verdad para los cambios aquí
enumerados; los documentos históricos no amplían este alcance.

## Objetivo y alcance

Actualizar la identificación de usuarios de legajo a DNI, persistir y renovar
sesiones, administrar ubicación de carros y asignaciones, permitir la gestión
segura de roles desde la página y ocultar notificaciones a administradores.
Mantener la aplicación vanilla, API Node.js CommonJS y PostgreSQL existentes,
sin dependencias nuevas ni acceso a la base remota.

## Comportamiento esperado

### DNI

- Agregar una migración nueva que renombre `users.legajo` a `users.dni` y
  conserve valores, unicidad y referencias. Reflejar el esquema en
  `database/schema.sql` y los datos iniciales en `database/seed.sql`.
- Cambiar los contratos, rutas, respuestas, formularios, tablas, perfil y
  búsquedas para usar DNI; la ruta administrativa de usuario usa
  `PATCH /api/admin/users/:dni`.
- Validar únicamente las altas nuevas: DNI de 7 a 10 dígitos numéricos, con
  error HTTP 400 claro; el input usa `inputmode="numeric"`. Las cuentas ya
  existentes no se reescriben ni se invalidan por este formato.
- DNI solo se expone al administrador y al propio usuario; no se registra en
  logs.
- Los backups nuevos usan `dni`; la restauración acepta backups previos con
  `legajo` y conserva sus valores.

### Sesiones y rendimiento

- El formulario ofrece “Mantener sesión iniciada”. Con la opción marcada, el
  token se guarda en `localStorage`; de lo contrario, en `sessionStorage`.
  Nunca se guarda la contraseña. Al cargar, validar el token con `GET /api/me`
  y restaurar la sesión. Ante 401, borrar la sesión y volver al login con un
  mensaje; logout limpia ambas ubicaciones.
- Si el token expira en menos de dos horas, `POST /api/auth/refresh` emite uno
  nuevo.
- Al abrir la página, llamar `GET /health` para calentar la API. El login usa
  una consulta a la base. Los datos posteriores al login se piden en paralelo
  y solo se cargan los necesarios para el rol o vista activa. El botón de login
  se deshabilita y muestra “Ingresando...” durante la operación.
- Añadir índices útiles sin alterar datos existentes.

### Ubicación, carros y reservas

- Nueva migración: `carros.ubicacion` nullable, con CHECK limitado a
  `taller`, `teoria_pb`, `teoria_p1` o `teoria_p2`; los carros existentes
  quedan sin ubicación. Las etiquetas visibles son Taller, Teoría – Planta
  baja, Teoría – 1.er piso y Teoría – 2.º piso.
- `GET /api/carros` requiere autenticación y devuelve `numero`, `ubicacion`,
  `total` y `disponibles` por carro.
- El formulario de reservas ofrece ubicación (“Todas”) y carro; el filtro de
  ubicación actualiza los carros y las notebooks disponibles. Los carros sin
  disponibilidad se deshabilitan. La validación de pertenencia se aplica en
  el backend, con errores 400/409 claros, para reservas individuales y lotes.
- Inventario permite cambiar ubicación con
  `PATCH /api/admin/carros/:numero`, renumerar carros con la clave foránea de
  notebooks en `ON UPDATE CASCADE`, y borrar carros solo si no tienen
  notebooks (409 en caso contrario).
- El administrador puede mover una notebook mediante
  `PATCH /api/notebooks/:codigo` con el carro de destino. Número de carro:
  entre 1 y 3 dígitos, sin duplicados.

### Gestión de roles y notificaciones

- Administración puede asignar `alumno`, `profesor` o `admin` (etiquetado
  “Administrador”) mediante `PATCH /api/admin/users/:dni/rol`.
- Solo admin puede cambiar roles; no puede cambiar el propio rol ni dejar el
  sistema sin administradores. Ascender a administrador exige confirmar la
  contraseña del administrador actuante.
- Registrar el cambio en `audit_log` si está disponible. Los permisos
  efectivos se consultan desde la base en cada solicitud o se invalidan las
  sesiones afectadas de inmediato.
- Ocultar notificaciones del perfil y de cualquier otro lugar solo para admin;
  el comportamiento de alumno y profesor no cambia.

## Migraciones y compatibilidad

- No editar migraciones existentes; crear migraciones incrementales nuevas.
- Reflejar el esquema final en `database/schema.sql` y revisar `seed.sql`.
- Preservar datos actuales y compatibilidad del API y de backups existentes.
- No consultar ni modificar la base remota. Indicar al cierre si corresponde
  ejecutar `npm run db:migrate`.

## Criterios de aceptación

1. Las altas rechazan DNI fuera de 7–10 dígitos con 400; las cuentas existentes
   conservan sus identificadores. Las respuestas y la interfaz respetan la
   visibilidad de DNI; restore acepta tanto `dni` como `legajo`.
2. Se restaura sesión desde el almacenamiento apropiado, valida `/api/me`,
   renueva tokens próximos a vencer y limpia todo al salir o ante 401.
3. Las cargas del login ocurren en paralelo y por rol/vista; `/health` se llama
   al abrir; el login informa y bloquea duplicados mientras autentica.
4. Los carros informan ubicación, total y disponibilidad; se puede filtrar y
   reservar únicamente dentro de la ubicación elegida; la API aplica permisos,
   límites y errores claros para actualización, renumeración, eliminación y
   traslado de notebooks.
5. Se puede cambiar rol respetando confirmación, no auto-cambio y último admin;
   los cambios se auditan cuando la tabla existe y surten efecto inmediato.
6. Notificaciones están ocultas para admin y permanecen disponibles para los
   demás roles.
7. Añadir pruebas focalizadas para DNI/backup, sesión/refresh, carros y reservas,
   permisos/reglas de roles, y visibilidad de notificaciones. La suite no debe
   empeorar respecto de la línea base.
8. Actualizar README, DEPLOY, PROYECTO y `.env.example` cuando aplique. No
   versionar credenciales ni datos sensibles; no añadir dependencias.

## Validación y cierre

- Ejecutar pruebas específicas y la suite disponible; documentar fallos de
  entorno o de base aislada sin atribuirlos al cambio.
- Revisar `git diff --stat`, crear un commit inicial claro con el proyecto
  fuente/configuración/documentación necesario, excluir datos sensibles y
  `reportes y cosas extra/`, y no hacer push.
