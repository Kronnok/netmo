# NetMO — Documentación de la API


## Generalidades

**URL base:** http://localhost:3000 (puerto configurable con la variable API_PORT).

**Formato:** todas las peticiones con cuerpo y todas las respuestas son JSON (UTF-8). Las peticiones con cuerpo envían el header `Content-Type: application/json`.

**Autenticación:** el endpoint POST /api/auth/login devuelve un token. El resto de las rutas (excepto /health) exige el header `Authorization: Bearer <token>`. Los tokens se mantienen en memoria del servidor.

**Roles:** alumno, profesor y admin. Las rutas marcadas como admin solo pueden usarse con ese rol. Los usuarios bloqueados (baneado) reciben 403.

**CORS:** el origen del frontend se configura con la variable CORS_ORIGIN. Métodos permitidos: GET, POST, PATCH, DELETE y OPTIONS.

**Errores:** las respuestas de error tienen la forma {"error": "mensaje"}.

| Código | Significado | Cuándo ocurre |
|---|---|---|
| 200 / 201 / 202 | Éxito | 200 consulta o modificación; 201 recurso creado; 202 solicitud aceptada y pendiente. |
| 400 | Solicitud inválida | Faltan datos o no cumplen las reglas de validación. |
| 401 | No autenticado | Falta el token, es inválido o las credenciales son incorrectas. |
| 403 | Sin permiso | El rol no alcanza o la cuenta está bloqueada. |
| 404 | No encontrado | El recurso no existe o no se puede modificar. |
| 409 | Conflicto | No hay notebooks disponibles o hay una entrega pendiente. |
| 500 | Error del servidor | Falla interna o regla de la base de datos (ej.: horario no permitido). |


## Resumen de endpoints

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | /health | Público | Estado de la API y la base |
| POST | /api/auth/login | Público | Inicia sesión y devuelve token |
| GET | /api/me | Autenticado | Datos del usuario logueado |
| GET | /api/preferences | Autenticado | Lee las preferencias |
| PATCH | /api/preferences | Autenticado | Actualiza las preferencias |
| GET | /api/notebooks | Autenticado | Lista las notebooks y su estado |
| PATCH | /api/notebooks/:codigo | Admin | Cambia el estado de una notebook |
| GET | /api/reservations | Autenticado | Reservas del usuario |
| POST | /api/reservations | Autenticado | Crea una reserva |
| DELETE | /api/reservations/:codigo | Autenticado | Cancela una reserva propia |
| GET | /api/admin/reservations | Admin | Lista todas las reservas |
| POST | /api/admin/reservations/:id/approve | Admin | Aprueba un lote |
| GET | /api/loans | Autenticado | Préstamos activos del usuario |
| POST | /api/loans/:id/return | Autenticado | Solicita la devolución |
| GET | /api/admin/returns | Admin | Devoluciones pendientes |
| POST | /api/admin/returns/:id/confirm | Admin | Confirma una devolución |
| GET | /api/tickets | Autenticado | Tickets del usuario |
| POST | /api/tickets | Autenticado | Crea un ticket de falla |
| GET | /api/admin/tickets | Admin | Lista todos los tickets |
| PATCH | /api/tickets/:codigo | Admin | Cambia el estado de un ticket |
| GET | /api/admin/late-returns | Admin | Resumen de devoluciones tardías |
| PATCH | /api/admin/users/:legajo | Admin | Bloquea o reactiva un usuario |


## Detalle de los endpoints

Todos los endpoints autenticados pueden responder además 401 {"error": "No autenticado"} si falta o es inválido el token, y 403 {"error": "Cuenta no autorizada"} si el usuario está bloqueado. Los timestamps se devuelven en formato ISO 8601.


## Sesión y usuario


### `GET /health`

**Acceso:** Público

**Descripción:** Verifica que la API y la base de datos respondan.

**Respuesta exitosa (200):**

```json
{
  "ok": true,
  "service": "netmo-api"
}
```


### `POST /api/auth/login`

**Acceso:** Público

**Descripción:** Valida correo y contraseña contra el hash almacenado y devuelve un token de sesión.

**Cuerpo de la petición (JSON):**

```json
{
  "email": "tprado@ottokrause.edu.ar",
  "password": "********"
}
```

**Respuesta exitosa (200):**

```json
{
  "token": "9f2c1a...e41b",
  "user": {
    "id": 1,
    "legajo": "2024-0417",
    "nombre": "Teo Prado",
    "email": "tprado@ottokrause.edu.ar",
    "curso": "6° Informática \"B\"",
    "rol": "alumno",
    "baneado": false
  }
}
```

**Errores posibles:** 401 {"error": "Correo o contraseña incorrectos"}; 403 {"error": "Usuario bloqueado por administración"}.


### `GET /api/me`

**Acceso:** Autenticado

**Descripción:** Devuelve los datos del usuario dueño del token.

**Respuesta exitosa (200):**

```json
{
  "user": {
    "id": 1,
    "legajo": "2024-0417",
    "nombre": "Teo Prado",
    "email": "tprado@ottokrause.edu.ar",
    "curso": "6° Informática \"B\"",
    "rol": "alumno",
    "baneado": false
  }
}
```


### `GET /api/preferences`

**Acceso:** Autenticado

**Descripción:** Devuelve las preferencias de notificación. Si el usuario no las configuró, devuelve los valores por defecto.

**Respuesta exitosa (200):**

```json
{
  "preferences": {
    "email": true,
    "recordatorio": 30
  }
}
```


### `PATCH /api/preferences`

**Acceso:** Autenticado

**Descripción:** Crea o actualiza las preferencias del usuario.

**Reglas:** recordatorio solo admite 0, 15, 30 o 60 (minutos antes del vencimiento).

**Cuerpo de la petición (JSON):**

```json
{
  "email": true,
  "recordatorio": 15
}
```

**Respuesta exitosa (200):**

```json
{
  "preferences": {
    "email": true,
    "recordatorio": 15
  }
}
```

**Errores posibles:** 400 {"error": "Recordatorio inválido"}.


## Notebooks


### `GET /api/notebooks`

**Acceso:** Autenticado

**Descripción:** Lista todas las notebooks ordenadas por código. Si una notebook tiene una reserva activa se informa como reservada.

**Respuesta exitosa (200):**

```json
{
  "notebooks": [
    {
      "id": "NB-001",
      "estado": "disponible",
      "ubicacion": "Carro 1",
      "actualizada": "2026-10-13T08:00:00.000Z",
      "prestado_a": null
    },
    {
      "id": "NB-014",
      "estado": "prestada",
      "ubicacion": "—",
      "actualizada": "2026-10-13T08:00:00.000Z",
      "prestado_a": "Teo Prado"
    }
  ]
}
```


### `PATCH /api/notebooks/:codigo`

**Acceso:** Admin

**Descripción:** Cambia el estado de una notebook. Al pasar a mantenimiento se envía a Taller y se liberan sus reservas; al pasar a disponible vuelve a Carro 1, se liberan sus reservas y se resuelven sus tickets abiertos.

**Reglas:** estado admite: disponible, prestada, mantenimiento, pendiente_devolucion.

**Cuerpo de la petición (JSON):**

```json
{
  "estado": "mantenimiento"
}
```

**Respuesta exitosa (200):**

```json
{
  "notebook": {
    "id": "NB-004",
    "estado": "mantenimiento",
    "ubicacion": "Taller"
  }
}
```

**Errores posibles:** 400 {"error": "Estado de notebook inválido"}; 403 {"error": "Solo admin puede cambiar estados"}; 404 {"error": "Notebook no encontrada"}.


## Reservas


### `GET /api/reservations`

**Acceso:** Autenticado

**Descripción:** Lista las reservas del usuario ordenadas por fecha de retiro.

**Respuesta exitosa (200):**

```json
{
  "reservations": [
    {
      "id": "RES-01",
      "tipo": "individual",
      "carro": "Carro 2",
      "curso": null,
      "cantidad": 1,
      "retiro_at": "2026-08-26T09:00:00.000Z",
      "motivo": "Física — laboratorio",
      "estado": "confirmada",
      "notebook_ids": [
        5
      ]
    }
  ]
}
```


### `POST /api/reservations`

**Acceso:** Autenticado

**Descripción:** Crea una reserva y asigna automáticamente las notebooks disponibles dentro de una transacción.

**Reglas:** tipo: individual (por defecto) o lote. Los alumnos solo pueden pedir 1 notebook. Los lotes son solo para profesores, de 3 a 40 equipos, quedan en pendiente_aprobacion y requieren el campo curso. La fecha debe ser del año actual, de lunes a viernes (viernes de 09:30 a 17:30; resto de días de 07:45 a 17:30). No se puede reservar si hay un préstamo o una reserva pendiente.

**Cuerpo de la petición (JSON):**

```json
{
  "tipo": "individual",
  "cantidad": 1,
  "retiroAt": "2026-10-20T09:00:00Z",
  "carro": "Carro 2",
  "motivo": "Física — laboratorio"
}
```

**Respuesta exitosa (201):**

```json
{
  "reservation": {
    "id": "RES-1760000000000",
    "id_codigo": "RES-1760000000000",
    "tipo": "individual",
    "carro": "Carro 2",
    "curso": null,
    "cantidad": 1,
    "retiro_at": "2026-10-20T09:00:00.000Z",
    "motivo": "Física — laboratorio",
    "estado": "confirmada"
  }
}
```

**Errores posibles:** 400 datos inválidos (retiroAt, cantidad, curso, alumno con más de una notebook, lote con menos de 3); 403 solo profesores pueden solicitar lotes; 409 entrega pendiente o notebooks insuficientes; 500 fecha u horario fuera de lo permitido.


### `DELETE /api/reservations/:codigo`

**Acceso:** Autenticado

**Descripción:** Cancela una reserva propia en estado confirmada o pendiente_aprobacion y libera las notebooks asignadas.

**Respuesta exitosa (200):**

```json
{
  "message": "Reserva cancelada"
}
```

**Errores posibles:** 404 {"error": "Reserva no encontrada o no cancelable"}.


### `GET /api/admin/reservations`

**Acceso:** Admin

**Descripción:** Lista todas las reservas con los datos de su titular y la cantidad de equipos asignados.

**Respuesta exitosa (200):**

```json
{
  "reservations": [
    {
      "id": 2,
      "codigo": "RES-1760000000001",
      "tipo": "lote",
      "curso": "Profesor · Cátedra Programación",
      "cantidad": 3,
      "retiro_at": "2026-10-21T08:00:00.000Z",
      "motivo": "Práctica de redes",
      "estado": "pendiente_aprobacion",
      "legajo": "PRF-010",
      "nombre": "Prof. Ana Gómez",
      "equipos_asignados": 3
    }
  ]
}
```

**Errores posibles:** 403 {"error": "Solo admin puede consultar reservas"}.


### `POST /api/admin/reservations/:id/approve`

**Acceso:** Admin

**Descripción:** Aprueba un lote pendiente (:id es el id numérico de la reserva). Las notebooks pasan a prestadas al titular.

**Respuesta exitosa (200):**

```json
{
  "message": "Lote aprobado"
}
```

**Errores posibles:** 403 solo admin; 404 {"error": "Solicitud de lote no encontrada"}.


## Préstamos y devoluciones


### `GET /api/loans`

**Acceso:** Autenticado

**Descripción:** Lista los préstamos del usuario que no fueron devueltos.

**Respuesta exitosa (200):**

```json
{
  "loans": [
    {
      "id": 1,
      "notebook": "NB-014",
      "retirada_at": "2026-10-13T08:00:00.000Z",
      "vence_at": "2026-10-13T09:00:00.000Z",
      "estado": "activo",
      "devolucion_estado": null
    }
  ]
}
```


### `POST /api/loans/:id/return`

**Acceso:** Autenticado

**Descripción:** El usuario solicita devolver un préstamo activo propio. Queda pendiente de confirmación por el administrador.

**Respuesta exitosa (202):**

```json
{
  "message": "Devolución pendiente de confirmación"
}
```

**Errores posibles:** 404 {"error": "Préstamo activo no encontrado"}.


### `GET /api/admin/returns`

**Acceso:** Admin

**Descripción:** Lista las devoluciones pendientes de confirmar.

**Respuesta exitosa (200):**

```json
{
  "returns": [
    {
      "id": 1,
      "notebook": "NB-014",
      "legajo": "2024-0417",
      "nombre": "Teo Prado",
      "curso": "6° Informática \"B\"",
      "solicitado_at": "2026-10-13T09:10:00.000Z",
      "vence_at": "2026-10-13T09:00:00.000Z"
    }
  ]
}
```

**Errores posibles:** 403 {"error": "Solo admin puede consultar devoluciones"}.


### `POST /api/admin/returns/:id/confirm`

**Acceso:** Admin

**Descripción:** Confirma una devolución: el préstamo pasa a devuelto y la notebook vuelve a disponible. Si se devolvió después del vencimiento, se registra una devolución tardía.

**Respuesta exitosa (200):**

```json
{
  "message": "Devolución confirmada"
}
```

**Errores posibles:** 403 solo admin; 404 {"error": "Devolución pendiente no encontrada"}.


## Tickets


### `GET /api/tickets`

**Acceso:** Autenticado

**Descripción:** Lista los tickets creados por el usuario, del más reciente al más antiguo.

**Respuesta exitosa (200):**

```json
{
  "tickets": [
    {
      "id": "TCK-014",
      "notebook": "NB-004",
      "motivo": "La pantalla se apaga sola",
      "descripcion": "La pantalla se apaga sola después de unos minutos de uso.",
      "estado": "progreso",
      "created_at": "2026-10-10T12:00:00.000Z"
    }
  ]
}
```


### `POST /api/tickets`

**Acceso:** Autenticado

**Descripción:** Crea un ticket de falla. Si se indica una notebook disponible, esta pasa a mantenimiento.

**Reglas:** motivo y descripcion son obligatorios; notebook (código del equipo) es opcional.

**Cuerpo de la petición (JSON):**

```json
{
  "notebook": "NB-004",
  "motivo": "La pantalla se apaga sola",
  "descripcion": "Se apaga después de unos minutos de uso."
}
```

**Respuesta exitosa (201):**

```json
{
  "ticket": {
    "id": "TCK-1760000000000",
    "estado": "abierto"
  }
}
```

**Errores posibles:** 500 si falta motivo o descripcion (la base los exige).


### `GET /api/admin/tickets`

**Acceso:** Admin

**Descripción:** Lista todos los tickets e incluye el nombre y rol de quien los creó.

**Respuesta exitosa (200):**

```json
{
  "tickets": [
    {
      "id": "TCK-014",
      "notebook": "NB-004",
      "motivo": "La pantalla se apaga sola",
      "descripcion": "La pantalla se apaga sola después de unos minutos de uso.",
      "estado": "progreso",
      "created_at": "2026-10-10T12:00:00.000Z",
      "owner_nombre": "Teo Prado",
      "owner_rol": "alumno"
    }
  ]
}
```

**Errores posibles:** 403 {"error": "Solo admin puede consultar tickets"}.


### `PATCH /api/tickets/:codigo`

**Acceso:** Admin

**Descripción:** Cambia el estado de un ticket. Al resolverlo se registra quién y cuándo, y la notebook en mantenimiento vuelve a disponible.

**Reglas:** estado admite: abierto, progreso, resuelto.

**Cuerpo de la petición (JSON):**

```json
{
  "estado": "resuelto"
}
```

**Respuesta exitosa (200):**

```json
{
  "ticket": {
    "id": "TCK-014",
    "estado": "resuelto"
  }
}
```

**Errores posibles:** 400 {"error": "Estado de ticket inválido"}; 403 solo admin; 404 {"error": "Ticket no encontrado"}.


## Administración de usuarios


### `GET /api/admin/late-returns`

**Acceso:** Admin

**Descripción:** Resumen de devoluciones tardías por usuario (excluye administradores). candidato_a_sancion es verdadero a partir de 3 tardanzas.

**Respuesta exitosa (200):**

```json
{
  "users": [
    {
      "id": 1,
      "legajo": "2024-0417",
      "nombre": "Teo Prado",
      "rol": "alumno",
      "tardanzas": 3,
      "candidato_a_sancion": true,
      "baneado": false
    }
  ]
}
```

**Errores posibles:** 403 {"error": "Solo admin puede consultar demoras"}.


### `PATCH /api/admin/users/:legajo`

**Acceso:** Admin

**Descripción:** Bloquea (baneado: true) o reactiva (baneado: false) a un usuario. No se pueden modificar cuentas de administrador.

**Cuerpo de la petición (JSON):**

```json
{
  "baneado": true
}
```

**Respuesta exitosa (200):**

```json
{
  "user": {
    "legajo": "2024-0417",
    "nombre": "Teo Prado",
    "baneado": true
  }
}
```

**Errores posibles:** 403 solo admin; 404 {"error": "Usuario no encontrado o no modificable"}.
