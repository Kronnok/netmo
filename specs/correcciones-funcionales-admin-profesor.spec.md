# Especificación: correcciones funcionales de administración y profesor

## Estado

Aprobada por el propietario el 10 de noviembre de 2026. Se eligió deshabilitar
recordatorios hasta integrar Gmail, migrar carros y ubicaciones a IDs estables
y reemplazar las reglas anteriores contradictorias en estos flujos.

## Objetivo y alcance

Corregir los flujos de respuestas de tickets, recordatorios, préstamos y
devoluciones, renumeración de carros y edición de ubicaciones; separar el
registro físico de una devolución de su historial. Mantener la autorización
administrativa en el backend, persistencia coherente y actualización inmediata
de la interfaz.

No se integrará Gmail ni se reemplazará el servicio de correo compartido. Los
recordatorios quedan deshabilitados hasta esa integración; otros tipos de correo
siguen usando su configuración actual. No se añadirán dependencias. La
migración de IDs estables debe preservar datos y relaciones existentes. No se
aplicará ninguna migración a una base remota ni se usarán credenciales de
producción.

## Hechos observados

- El endpoint de respuestas GET permite al administrador y al dueño del ticket;
  POST requiere rol `admin`. `abrirRespuestasTicket` oculta formulario y botón
  para roles distintos de administrador. La documentación `PROYECTO.md` y una
  especificación anterior dicen que los dueños pueden responder; ese criterio
  contradice esta solicitud y debe actualizarse si se aprueba.
- El botón de recordatorios llama `POST /api/admin/reminders/run`. El servicio
  procesa recordatorios por vencimiento y preferencias, usando proveedores
  `gas`, `brevo` o `console` en desarrollo. Si falla el proveedor, la ruta
  puede responder con cero envíos y la interfaz presenta un mensaje de éxito.
  Por ello, no se puede asumir que Gmail sea el único proveedor real disponible.
- `carros.numero` es actualmente clave primaria. `notebooks.carro_id` lo
  referencia con `ON UPDATE CASCADE` en el esquema final; además,
  `notebooks.ubicacion` almacena texto como `Carro N`. `updateCarro` actualiza
  el número pero no sincroniza esa etiqueta redundante. Los préstamos apuntan
  a notebooks; las reservas guardan el número de carro como texto.
- `ubicaciones.slug` es clave primaria y `carros.ubicacion` lo referencia con
  `ON UPDATE CASCADE`. `updateUbicacion` solo modifica `nombre`, por eso el slug
  permanece igual.
- El propietario aprobó agregar IDs inmutables a carros y ubicaciones, hacerlos
  las claves primarias y migrar las FK de notebooks/carros. `numero` y `slug`
  pasan a ser valores únicos y editables. Las reservas existentes que guardan
  el carro como texto se preservan como dato histórico; los préstamos conservan
  su relación con notebook y la notebook con el ID estable del carro.
- El backend ya registra devoluciones dentro de una transacción, bloquea el
  préstamo, admite préstamos activos antes del vencimiento y rechaza préstamos
  devueltos con 409. Actualiza préstamo, registro de recepción y notebook. La
  UI de «Entregas y devoluciones» solo consulta al escribir al menos dos
  caracteres y filtra `estado=activo`; no ofrece una lista inicial. La vista
  «Devoluciones» carga préstamos activos y pendientes, pero solo permite
  confirmar físicamente los que ya están en `devolucion_pendiente`.
- `/api/admin/returns` lista notificaciones pendientes, no historial. La tabla
  `returns` ya guarda `confirmado_por` y `confirmado_at`; `late_returns` solo
  conserva demoras, no todas las devoluciones.
- Los backups exportan la estructura actual de carros/ubicaciones y validan
  sus referencias por número/slug; la migración requiere preservar también
  restauraciones de backups previos.
- No existe `CONTEXT.md` en el repositorio. La documentación adicional
  `documentacion-netmo.txt` describe una arquitectura anterior de página única;
  la aplicación ejecutable actual usa `frontend/`, una API Node.js y PostgreSQL.

## Comportamiento esperado

1. **Tickets:** profesor/dueño puede consultar el hilo y leer respuestas
   administrativas, pero no ve ni utiliza controles para contestar. POST de
   respuestas rechaza con 403 todo rol distinto de admin. El administrador
   conserva lectura y respuesta.
2. **Recordatorios:** el envío de recordatorios se mantiene deshabilitado hasta
   integrar Gmail. La interfaz y las rutas manual/cron informan claramente que
   no está disponible y no marcan préstamos como notificados. No se altera el
   envío de otros tipos de correo ni la configuración de GAS/Brevo para esos
   flujos.
3. **Carros:** cambiar el número actualiza el carro y las notebooks asociadas
   en una sola operación, conserva las relaciones con préstamos y no crea
   duplicados. Todas las vistas relevantes muestran el número vigente.
4. **Ubicaciones:** al renombrar, se normaliza el nombre para producir un slug
   en minúsculas, sin diacríticos ni caracteres especiales y con guiones entre
   palabras. La actualización es atómica, rechaza conflictos sin cambiar datos
   y mantiene la relación de los carros mediante ID estable. La UI presenta los
   valores persistidos.
5. **Devoluciones:** al entrar a «Entregas y devoluciones» se listan sin buscar
   todos los préstamos pendientes (activos o pendientes de confirmación), tanto
   dentro del plazo como próximos a vencer o vencidos. Se puede buscar por
   nombre, apellido, DNI, notebook o número de préstamo; el vencimiento solo
   determina mora y no bloquea la devolución anticipada. Una devolución exitosa
   actualiza de inmediato el préstamo y la disponibilidad, elimina el equipo
   de pendientes y muestra que ya fue devuelto. Las repeticiones se rechazan
   sin modificaciones ni registros duplicados.
6. **Historial:** «Devoluciones» muestra solo operaciones confirmadas, con
   alumno, notebook, préstamo asociado, fecha/hora y administrador que recibió
   el equipo. Permite buscar/filtrar y no ofrece acciones para registrar otra
   vez una devolución.
7. El administrador sigue siendo el único rol que confirma la recepción física.
   Se excluyen del listado de pendientes los préstamos devueltos.

## Archivos y componentes previstos

- `frontend/app.js`, `frontend/index.html`, posiblemente `frontend/styles.css`
- `backend/services/api-service.js`, posiblemente `backend/routes.js`
- `backend/services/backup-service.js`, `backend/scripts/db.js`
- `backend/test/` y `backend/scripts/run-integration.js` (pruebas unitarias,
  migración y flujos de integración aislados)
- `database/schema.sql`, una migración aditiva nueva para IDs estables y
  `database/seed.sql`
- `PROYECTO.md` y documentación funcional relacionada, para corregir criterios
  contradictorios después de validar el comportamiento

## Criterios de aceptación verificables

- CA-01: como profesor, al abrir un ticket respondido se ve la respuesta y no
  aparecen textarea ni botón de envío; POST directo de profesor responde 403.
- CA-02: como administrador, el formulario de respuesta sigue disponible y
  una respuesta se persiste y se ve en el hilo.
- CA-03: el botón de recordatorio no muestra un éxito falso ni marca un correo
  fallido como enviado; el mensaje/estado del API refleja la disponibilidad.
- CA-04: al renumerar un carro, todas sus notebooks muestran el nuevo número
  tras guardar y tras recargar; la asignación de préstamos existentes no cambia.
- CA-05: al renombrar una ubicación, el slug cumple la normalización, las
  relaciones de carros siguen válidas y un slug en conflicto no altera datos.
- CA-06: al entrar a «Entregas y devoluciones» aparecen los préstamos elegibles
  sin escribir en el buscador; incluye préstamos no vencidos y vencidos.
- CA-07: una devolución anticipada actualiza la UI y los datos persistidos sin
  recarga manual; el botón de recepción deja de aparecer.
- CA-08: repetir la misma devolución responde conflicto y no duplica ni modifica
  la devolución ya confirmada.
- CA-09: «Devoluciones» solo muestra historial confirmado con receptor, hora,
  persona, notebook y préstamo; no permite registrar otra devolución.
- CA-10: pruebas focalizadas pasan; el resto de la suite no presenta regresiones.
- CA-11: los casos que requieren PostgreSQL se ejecutan exclusivamente contra
  una base local/de prueba aislada. Las pruebas de navegador se marcan
  bloqueadas si no hay servidor y datos de prueba accesibles, nunca se simulan
  como verificación realizada.
- CA-12: la migración conserva filas y sus relaciones de carros/ubicaciones;
  backups nuevos y backups anteriores siguen siendo restaurables sin perder
  notebook, carro, ubicación ni préstamo.

## Plan técnico tras la aprobación

1. Capturar línea base y comprobar entorno local de pruebas sin acceder a
   producción.
2. Auditar FK, respaldos, seed, runner y todas las consultas que dependen de
   carro/slug antes de diseñar la migración.
3. Cubrir reglas de servicio/API: autorización, slug único, renumeración
   coherente, devolución anticipada, idempotencia, búsqueda inicial e historial.
4. Implementar migración transaccional y consultas/API que usan IDs internos,
   manteniendo números y slugs como datos editables y contratos legibles.
5. Actualizar controles, lista inicial, actualización tras devolución y vista de
   historial; mantener mensajes en español.
6. Ejecutar pruebas de API/servicio y regresión; luego pruebas reales en navegador
   con roles de prueba y datos locales. No declarar verificaciones inaccesibles.
7. Actualizar documentación para que describa permisos y responsabilidades
   aprobados.

## Decisiones aprobadas

1. Los recordatorios quedan deshabilitados hasta que Gmail se integre; GAS/Brevo
   siguen disponibles para otros correos.
2. Agregar IDs estables de carros y ubicaciones y migrar referencias.
3. En los flujos incluidos, esta especificación reemplaza reglas anteriores que
   permitían responder tickets al dueño o enviar recordatorios usando GAS/Brevo.

## Resultado de implementación y validación

- Implementados los permisos de respuesta de tickets, el bloqueo explícito de
  recordatorios, la migración a IDs estables, la actualización de búsqueda y
  devolución de préstamos, y la vista de historial de recepciones.
- `npm test`: 65 pruebas pasaron, 0 fallaron y 1 prueba de integración se omitió
  por falta de `TEST_DATABASE_URL`.
- La sintaxis de los archivos JavaScript modificados y `git diff --check`
  pasaron.
- Se añadieron comprobaciones de integración para renumeración, cambio de slug,
  devolución anticipada, duplicados, historial y respuestas de tickets; no se
  ejecutaron porque no hay una base de pruebas aislada disponible.
- Las pruebas de navegador con sesiones reales también quedan bloqueadas hasta
  disponer de una API y una base de datos de prueba accesibles. No se aplicó la
  migración ni se accedió a producción.
