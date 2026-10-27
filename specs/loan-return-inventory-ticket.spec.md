# Especificación: devoluciones, inventario y tickets

## Estado

Aprobada según los comportamientos y criterios solicitados por el usuario.

## Objetivo y alcance

Corregir y verificar la solicitud y confirmación de devoluciones, el vencimiento
de préstamos nuevos, el filtrado de estados físicos del inventario y los cambios
de estado de notebooks asociados a tickets. No modificar otros flujos de
reservas o tickets.

## Hechos observados

- `CONTEXT.md` no existe en este workspace.
- `documentacion-netmo.txt` describe devoluciones, inventario y tickets, pero no
  contempla hora prevista de devolución ni el tope de vencimiento a las 17:30.
- La solicitud HTTP de devolución actual no recibe ni guarda una hora prevista.
- El préstamo nuevo vence ocho horas después del retiro, sin limitarse al cierre
  del mismo día.
- La API de notebooks puede proyectar como `reservada` un equipo con reserva
  activa independientemente de su estado físico.
- El cambio administrativo de ticket conserva casts explícitos de
  `ticket_status` y `bigint`, pero no actualiza la notebook al avanzar y puede
  liberarla al resolver aunque exista otro ticket activo.
- La línea base `npm test` registra 35 pruebas aprobadas, un fallo en una
  expectativa de test que no contempla el cast `$3::bigint`, y una prueba de
  integración omitida porque `TEST_DATABASE_URL` no está configurada.

## Comportamiento esperado

### Devoluciones y vencimientos

- Alumno o profesor solicita la devolución indicando una hora de hoy, en
  `America/Argentina/Buenos_Aires`, posterior al instante actual y hasta las
  17:30 inclusive.
- Frontend ofrece un selector de hora con máximo 17:30 y un mensaje claro;
  backend rechaza entradas ausentes o inválidas con HTTP 400 claro.
- La solicitud mantiene el préstamo en `devolucion_pendiente`, la notebook en
  `pendiente_devolucion` y el `prestado_a` actual; la confirmación administrativa
  completa el préstamo y libera la notebook.
- Guardar la hora en `returns.hora_prevista`, nullable, mediante migración
  incremental nueva y reflejarla en `schema.sql`, "Mis préstamos" y el panel
  administrativo de devoluciones.
- Solo los préstamos creados después del cambio vencen al menor entre retiro +
  ocho horas y las 17:30 del mismo día local. La detección de tardanza usa el
  `vence_at` guardado y la devolución efectiva confirmada.

### Inventario

- El filtro administrativo compara el estado físico recibido con los valores del
  enum y muestra resultados en todos los estados.
- Una reserva activa solo proyecta `reservada` cuando la notebook está
  `disponible`; los estados físicos prevalecen.

### Tickets

- Al pasar un ticket a `progreso`, una notebook `disponible` pasa a
  `mantenimiento`; estados `prestada` y `pendiente_devolucion` no cambian.
- Al resolver, una notebook vuelve a `disponible` solo si estaba en
  `mantenimiento` y ya no tiene otro ticket `abierto` o `progreso`.
- Reabrir a `abierto` no cambia el estado de la notebook.
- Conservar los casts `$n::ticket_status` y `$n::bigint`; no cambiar otros
  comportamientos del flujo de tickets.

## Archivos previstos

- `backend/services/business-time.js` y `backend/services/api-service.js`.
- `backend/test/loan-workflow.test.js`,
  `backend/test/security-and-business-rules.test.js`,
  `backend/services/backup-service.js` y
  `backend/test/backup-service.test.js`, y
  `backend/scripts/run-integration.js`.
- `frontend/app.js` y `frontend/index.html`.
- `database/schema.sql` y una nueva migración SQL incremental.
- Esta especificación como documentación del cambio.

## Criterios de aceptación

1. Tests cubren solicitar y confirmar devolución, estados de préstamo/notebook,
   persistencia de `prestado_a` y retorno a disponible.
2. Tests cubren hora posterior a ahora, límite 17:30, rechazo 400 y lectura de la
   hora en ambas vistas.
3. Tests verifican los dos límites de vencimiento en zona Buenos Aires y que
   solo el vencimiento de préstamos nuevos cambia; una confirmación posterior
   al `vence_at` guardado sigue registrando tardanza.
4. Tests verifican el filtro para todos los estados y que una reserva activa no
   oculte un estado físico.
5. Tests cubren las transiciones de tickets y la protección ante otros tickets
   activos, conservando los casts SQL.
6. La suite final no tiene menos pruebas aprobadas que la línea base; tests de
   integración solo se ejecutan si `TEST_DATABASE_URL` pasa las validaciones de
   aislamiento. No acceder ni modificar una base de producción.

## Migración, riesgos y validación

- La nueva columna es nullable para conservar compatibilidad con solicitudes
  históricas; `npm run db:migrate` será necesario para bases ya inicializadas.
- No se recalculan vencimientos de préstamos existentes.
- Validar con `npm test` y, si está disponible y es segura, con la suite HTTP
  sobre `TEST_DATABASE_URL`.
