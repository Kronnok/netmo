# Especificación: correcciones administrativas de NetMO

## Estado

Aprobada e implementada. Las pruebas unitarias y estáticas pasan; la suite de
integración aislada queda pendiente de `TEST_DATABASE_URL`.

Esta especificación sustituye los comportamientos anteriores de aprobación y
cantidades de reservas y de metadatos de resolución de tickets donde contradiga
`functional-corrections.spec.md`, `users-reservations-tickets.spec.md` o la
documentación histórica. Los demás alcances de esos documentos no cambian.

## Objetivo

Corregir el cambio de estado de tickets que responde con error interno, permitir
que administración apruebe o rechace solicitudes individuales además de lotes,
quitar la ambigüedad entre las cantidades de solicitudes individuales y lotes, y
dejar explícito el comportamiento de los baneos.

## Hechos observados

- La UI actual envía `PATCH /api/tickets/:codigo` con los estados `abierto`,
  `progreso` o `resuelto`; el backend ejecuta la actualización y guarda actor y
  fecha al resolver.
- `database/schema.sql` declara `tickets.resolved_at` y `tickets.resolved_by`,
  pero ninguna migración existente agrega esas columnas a bases ya inicializadas.
- `backend/scripts/db.js` solo ejecuta `schema.sql` cuando no existe la tabla
  `users`; una base previa puede, por lo tanto, carecer de esas columnas y hacer
  fallar el `UPDATE` de tickets con HTTP 500.
- La UI y el backend actual solo permiten aprobar o rechazar solicitudes con
  `tipo = 'lote'`. Las reservas individuales nacen confirmadas.
- El formulario alterna entre cantidad individual y cantidad de lote. El
  backend permite hasta 40 unidades para ambos tipos; los alumnos están
  limitados a una. El lote tiene mínimo de tres.
- Hay un botón manual de desbaneo. Los baneos con vencimiento se limpian
  automáticamente cuando el usuario vuelve a autenticarse.
- No se reprodujo el error del ticket contra la base desplegada; no se consultó
  la base remota.
- `CONTEXT.md`, requerido por las instrucciones del repositorio, no existe en
  este workspace. Algunas especificaciones y documentos también describen
  reglas anteriores distintas.

## Comportamiento esperado propuesto

### Tickets

- Un administrador puede cambiar un ticket entre `abierto`, `progreso` y
  `resuelto`; puede reabrirlo.
- Resolver registra el actor y la fecha; reabrir limpia esos metadatos y no
  cambia automáticamente el estado de la notebook.
- Verificar que las bases ya inicializadas tengan las columnas de resolución y
  agregar una migración incremental e idempotente si faltan. La migración debe
  conservar los tickets existentes y no inventar quién resolvió casos previos.
- La UI debe mostrar un mensaje claro ante error; el estado no debe aparentar
  haberse guardado si la API falla.

### Aprobación y cantidades

- Todas las reservas, individuales y por lote, quedan pendientes de aprobación
  administrativa al crearse.
- Administración puede aprobar o rechazar ambos tipos. Aprobar permite luego
  registrar el retiro; rechazar libera las notebooks asignadas. Las operaciones
  deben ser transaccionales y no duplicar préstamos ni asignaciones.
- Una solicitud individual admite de 1 a 2 notebooks para profesores; los
  alumnos siguen limitados a 1.
- Un lote admite de 3 a 10 notebooks y sigue siendo exclusivo para profesores.
- Frontend y backend aplican los mismos límites; la cantidad se guarda y se
  asigna una sola vez por solicitud. No debe ser posible crear accidentalmente
  una solicitud de 9 unidades como individual ni exceder 10 en un lote.
- Los estados existentes (`pendiente_aprobacion`, `aprobada`, `rechazada`) y
  las rutas actuales se reutilizan salvo que la implementación revele una
  incompatibilidad necesaria de resolver.

### Baneos

- Se conserva el comportamiento actual: el administrador puede desbanear
  manualmente y los baneos temporales vencidos se levantan automáticamente al
  autenticarse.
- Los baneos indefinidos no vencen automáticamente.

## Archivos y componentes previstos

- `frontend/app.js` y `frontend/index.html`: estados y acciones administrativas,
  selección/cantidades de reservas y mensajes de error.
- `backend/services/api-service.js`: validación de cantidades, aprobación y
  rechazo de ambos tipos de reserva, cambio de ticket.
- `backend/services/auth-service.js`: conservar expiración automática y
  autenticación actual.
- `backend/routes.js`: mantener rutas existentes salvo necesidad demostrada.
- `database/migrations/`: nueva migración para compatibilidad de columnas de
  resolución si la inspección local de esquemas históricos la confirma.
- `database/schema.sql` y pruebas backend: reflejar y cubrir las reglas
  acordadas.
- `reportes y cosas extra/documentacion-netmo.txt`: actualizar solo después de
  validar.

## Criterios de aceptación

- CA-01: con las columnas presentes, admin puede abrir, avanzar, resolver y
  reabrir un ticket; actor/fecha se guardan al resolver y se limpian al reabrir.
- CA-02: una instalación ya inicializada sin columnas de resolución puede
  migrarse sin perder tickets; el cambio de estado ya no produce 500 por esas
  columnas.
- CA-03: una reserva individual de profesor de 1 o 2 notebooks queda pendiente
  de aprobación; administración puede aprobarla o rechazarla.
- CA-04: alumno solo puede pedir una unidad; profesor individual no supera 2;
  lote solo lo solicita profesor, acepta de 3 a 10 y rechaza valores fuera del
  rango tanto en UI como API.
- CA-05: todas las solicitudes aprobadas pueden retirarse una sola vez; las
  rechazadas liberan asignaciones y no crean préstamos.
- CA-06: el flujo manual de desbaneo sigue disponible y un baneo temporal
  vencido permite autenticarse sin intervención del administrador.
- CA-07: pruebas unitarias y de integración aislada cubren los criterios; no se
  accede ni modifica la base remota.

## Riesgos y decisiones

- El error 500 no se reprodujo localmente. Confirmar las columnas de la base
  afectada requiere logs o acceso autorizado a su esquema; queda fuera de esta
  revisión y no se debe consultar la base remota durante implementación.
- El cambio hace que también las reservas individuales requieran aprobación,
  alterando el flujo actual.
- Los límites propuestos se interpretan para reservas de profesores: individual
  máximo 2, lote máximo 10; alumno máximo 1. Confirmar que el lote mínimo
  existente de 3 permanece vigente.
- Esta propuesta no resuelve las contradicciones documentales preexistentes ni
  crea `CONTEXT.md`.