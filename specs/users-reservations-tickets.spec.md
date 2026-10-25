# Especificación: validaciones, tickets y reservas por carro

## Estado

Borrador pendiente de aprobación. No implementar cambios de código hasta que
esta especificación sea aprobada.

## Objetivo y alcance

Completar las validaciones de cuentas y solicitudes, permitir la gestión de
estados de tickets desde un selector administrativo y asignar reservas a un
carro elegido por el usuario. Mantener compatibilidad con las cuentas y filas
existentes, los roles actuales y las reglas de negocio que no se modifican aquí.

## Hechos observados

- `backend/services/validation.js` valida nombres de hasta 60 caracteres y
  emails de hasta 254; el formulario administrativo usa esos mismos máximos.
- `PATCH /api/tickets/:codigo` ya está registrado y limitado a administradores
  por el controlador; el servicio valida los estados `abierto`, `progreso` y
  `resuelto`. La interfaz administrativa aún usa botones separados.
- El esquema ya contiene `tickets.resolved_at` y `tickets.resolved_by`, y el
  servicio registra esos datos al resolver y los limpia al cambiar a otro
  estado. La resolución ya devuelve a disponible una notebook relacionada solo
  si estaba en mantenimiento.
- La API de carros actual es `/api/admin/carros` y solo permite consultas de
  administradores. Las reservas asignan notebooks disponibles sin filtrar por
  carro; la API ya rechaza con 409 si no alcanza la disponibilidad general.
- Los motivos de reserva y tickets ya se recortan y rechazan si quedan vacíos.
  Ambos límites actuales son 240 caracteres.
- El curso del profesor admite texto libre de hasta 120 caracteres.
- No se encontró `CONTEXT.md` en el repositorio. La documentación funcional
  está en `reportes y cosas extra/documentacion-netmo.txt`.
- El esquema existente no debe modificarse para imponer restricciones que
  afecten registros anteriores.

## Comportamiento esperado

### 1. Alta de usuarios

- Nombre, apellido y email tendrán un máximo de 50 caracteres cada uno.
- Backend: rechazar con HTTP 400 y mensaje claro todo valor que exceda el
  máximo. La regla aplica al alta de nuevas cuentas, no requiere migrar ni
  validar retroactivamente cuentas existentes.
- Frontend: `maxlength="50"` en los tres campos y contador visible por campo.

### 2. Estado de tickets

- Cada ticket de la vista administrativa tendrá un selector con `Abierto`,
  `En progreso` y `Resuelto`, mostrando su estado actual.
- Al cambiarlo se usará `PATCH /api/tickets/:codigo`. Solo administradores
  pueden actualizar tickets y el backend rechazará con HTTP 400 estados ajenos
  a `abierto`, `progreso` y `resuelto`.
- Retirar los botones individuales de cambio de estado.
- Al resolver, guardar quién y cuándo lo resolvió. Si la notebook asociada
  estaba en mantenimiento, devolverla a disponible. Al reabrir, limpiar los
  datos de resolución sin cambiar automáticamente el estado de la notebook.
- Mostrar estados en español legible y confirmar visualmente el guardado.
- Refrescar el estado visible en “Mis tickets” al entrar a la vista y después
  de cada acción que pueda actualizar tickets.

### 3. Motivos

- El motivo de reserva tendrá un máximo de 100 caracteres; recortar espacios
  extremos y rechazar un valor presente que quede vacío tras el recorte.
- Aplicar la validación en backend y frontend, con `maxlength="100"` y contador.
- Para el motivo del ticket, conservar el límite actual de 240 caracteres, ya
  que existe y no hace falta elevarlo. Mantener trim y rechazo de solo espacios.

### 4. Selección de carro en reservas

- `GET /api/carros` estará disponible para cualquier usuario autenticado y
  devolverá los carros con la cantidad de notebooks disponibles en cada uno.
- El formulario de reservas tendrá un selector para alumnos y profesores;
  mostrará esa cantidad y deshabilitará carros sin notebooks disponibles.
- La API asignará notebooks disponibles únicamente del carro elegido, dentro
  de la transacción de creación, tanto para reservas individuales como para
  lotes. Si no alcanza la cantidad solicitada, responderá HTTP 409 con mensaje
  claro y no dejará una reserva parcial.
- Los lotes mantienen su aprobación administrativa; la selección inicial de
  equipos será del carro solicitado.

### 5. Curso / división

- El valor persistido deberá cumplir `^[1-7]°(?:[1-9]|[1-9]\d)°$` y no superar
  5 caracteres. El backend responderá HTTP 400 ante cualquier valor inválido.
- El frontend reemplazará el texto libre por campos numéricos de Año y
  División, solo dígitos, con máximos de 1 y 2 dígitos. Armará el valor con
  `°` automáticamente y mostrará un ejemplo como `2°14°`.
- No agregar restricciones de base de datos que puedan invalidar filas
  existentes.

### 6. Pruebas y documentación

- Agregar o ajustar pruebas de servicios, rutas/controlador y validaciones de
  interfaz según los mecanismos ya presentes en el repositorio.
- Ejecutar toda la suite (`npm test`) y corregir fallas relacionadas con estos
  cambios.
- Actualizar `reportes y cosas extra/documentacion-netmo.txt` para reflejar los
  contratos y comportamientos nuevos.

## Archivos y módulos previstos

- `backend/services/validation.js`
- `backend/services/api-service.js`
- `backend/routes.js`
- `backend/test/`
- `frontend/index.html`
- `frontend/app.js`
- `reportes y cosas extra/documentacion-netmo.txt`

No se prevé cambio de esquema ni migración. Si durante la implementación se
descubre que los datos o el esquema existentes impiden cumplir estos requisitos
sin afectar filas anteriores, detenerse y actualizar esta especificación antes
de cambiar la base de datos.

## Criterios de aceptación verificables

1. Altas con nombre, apellido o email de 51 caracteres responden 400; los
   valores de 50 se aceptan si cumplen las demás reglas.
2. Frontend muestra máximo y contador de 50 para cada dato de usuario.
3. PATCH acepta solo los tres estados definidos, exige rol admin y el selector
   refleja el estado persistido. Resolver registra actor/fecha y libera solo
   notebooks asociadas que estén en mantenimiento; reabrir limpia actor/fecha
   y no cambia el estado de notebook.
4. Motivo de reserva vacío tras trim y de más de 100 caracteres se rechaza; un
   motivo de ticket vacío tras trim se rechaza y su límite de 240 permanece.
   Ambos formularios muestran su maxlength y contador correspondiente.
5. GET `/api/carros` requiere autenticación, funciona para cualquier rol
   autenticado e informa disponibilidad. Las reservas individuales y por lote
   solo asignan notebooks disponibles del carro pedido; una cantidad
   insuficiente produce 409 sin cambios parciales.
6. El backend acepta cursos conformes al patrón y rechaza los que no cumplen;
   la interfaz genera valores conformes desde los dos campos numéricos.
7. Las pruebas existentes y nuevas pasan con `npm test`; ninguna migración
   altera registros existentes.

## Riesgos y decisiones pendientes

- Aprobar este borrador antes de implementar.
- Confirmar durante la implementación el formato exacto de la respuesta de
  `/api/carros`; se propone `{ carros: [{ numero, disponibles }] }`, siguiendo
  el formato habitual de la API.
- Los lotes conservan el proceso de aprobación ya existente; la disponibilidad
  puede cambiar antes de aprobarlos. La aprobación deberá mantener sus
  validaciones transaccionales actuales y no sustituye la validación al crear.
