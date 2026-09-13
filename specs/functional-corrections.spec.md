# Especificacion: correcciones funcionales de prestamos y administracion de NetMO

## Estado
Aprobada para implementacion. Cambios implementados y pendientes de validacion funcional completa.

## Objetivo
Corregir las diferencias observadas entre el modo demo de `index.html` y la API de `backend/server.js` en los flujos de devoluciones, tickets, sanciones, reservas, preferencias e inventario, manteniendo las reglas de negocio existentes y la interfaz en espanol.

## Alcance

Incluye:

1. Estado visible de una devolucion pendiente para alumnos y profesores.
2. Resolucion y ocultamiento de tickets en Fallas reportadas.
3. Persistencia del baneo permanente para cualquier usuario elegible.
4. Restriccion de las reservas al ano calendario actual.
5. Persistencia de preferencias editables.
6. Eliminacion del cierre de sesion duplicado dentro de Preferencias.
7. Cambio de estados validos de notebooks desde Inventario.
8. Eliminacion de la espera obligatoria de 30 minutos para reservas individuales y lotes.
9. Paridad de comportamiento entre modo demo y modo API.

Fuera de alcance:

- Redisenar la interfaz completa.
- Cambiar roles o permisos existentes.
- Crear un sistema de notificaciones nuevo.
- Modificar la politica de backups de PostgreSQL.
- Agregar nuevas categorias de estado no definidas en el esquema.

## Hechos observados

- El inicio ya distingue un prestamo activo de una devolucion pendiente.
- La vista Mis prestamos aun muestra la fecha de vencimiento cuando la devolucion esta pendiente.
- El frontend demo oculta tickets resueltos y marca tickets relacionados al habilitar una notebook.
- En modo API, habilitar una notebook solo cambia el estado en memoria del navegador y no resuelve el ticket en PostgreSQL.
- La API de tickets permite cambiar unicamente el estado para un administrador.
- El formulario de preferencias actualiza solo `currentUser` y no llama a `/api/preferences`.
- La API ya tiene endpoints de lectura y actualizacion de preferencias.
- El formulario y el backend ya validan que una reserva pertenezca al ano actual.
- No se encontro una validacion de espera minima de 30 minutos.
- Inventario ofrece una opcion `reservada`, pero ese estado no pertenece al enum `notebook_status` de PostgreSQL.
- El baneo demo busca por legajo en la lista local, pero en modo API no llama a `/api/admin/users/:legajo`.
- La lista demo de tardanzas solo muestra usuarios con al menos una tardanza; Teo es el principal caso inicial, pero la implementacion no debe quedar hardcodeada a su legajo.

## Comportamiento esperado

### 1. Devoluciones pendientes

- Al solicitar una devolucion, el prestamo debe pasar a `devolucion_pendiente`.
- En Inicio y en Mis prestamos debe mostrarse que la devolucion fue informada y esta pendiente de confirmacion administrativa.
- Mientras este pendiente, no debe presentarse el equipo con el texto de deuda activa ni como una reserva que vence ese dia.
- La confirmacion administrativa debe liberar el prestamo y actualizar la notebook segun el flujo vigente: `disponible` o `mantenimiento`.
- Demo y API deben mostrar el mismo estado y transicion.

### 2. Tickets y notebooks habilitadas

- Un administrador solo puede modificar el estado del ticket mediante los estados existentes: `abierto`, `progreso` y `resuelto`.
- Los tickets `resuelto` no deben aparecer en la cola de Fallas reportadas ni incrementar su contador.
- Si se habilita una notebook desde mantenimiento, la operacion debe persistir en API:
  - notebook a `disponible`;
  - ubicacion a `Carro 1`;
  - ticket abierto relacionado a `resuelto`.
- La operacion debe ser consistente si se recarga la pagina.
- No se debe agregar una accion administrativa para editar descripcion, autor u otros datos del ticket.

### 3. Baneo permanente

- El administrador debe poder banear o desbanear al usuario seleccionado usando su legajo.
- La seleccion no debe depender de un legajo literal ni estar limitada a Teo.
- La lista de candidatos debe incluir usuarios alumno o profesor con tardanzas registradas, de acuerdo con los datos disponibles.
- No se puede banear ni modificar el estado de un administrador.
- En modo API, el cambio debe persistir mediante el endpoint existente.
- Un usuario baneado no puede iniciar sesion; al desbanearlo puede volver a iniciar sesion.
- La interfaz debe reflejar el estado persistido despues de recargar.

### 4. Reservas y ano actual

- El usuario no debe poder crear ni modificar una reserva fuera del ano calendario actual.
- El campo de fecha debe limitarse al rango permitido del ano actual y la validacion debe mantenerse en JavaScript, API y base de datos.
- No se agrega un campo separado para elegir el ano: el ano se deriva de la fecha actual y no constituye una opcion de negocio independiente.
- La misma regla aplica a reservas individuales y solicitudes de lote.
- Se mantienen las reglas existentes de fecha no pasada, dias habiles y horarios de retiro.

### 5. Preferencias y cierre de sesion

- El usuario puede modificar notificaciones por email y recordatorio de devolucion.
- Los valores permitidos de recordatorio son `0`, `15`, `30` y `60` minutos.
- En modo API, la lectura inicial debe cargar `/api/preferences` y los cambios deben persistir mediante `PATCH /api/preferences`.
- Un error de persistencia debe informarse y no presentarse como guardado exitoso.
- En modo demo, los cambios pueden permanecer en memoria durante la sesion.
- El cierre de sesion debe permanecer solo en la barra lateral; no debe existir una segunda accion dentro de Preferencias.

### 6. Inventario

- El administrador puede cambiar desde Inventario solo estados definidos por la base de datos: `disponible`, `prestada`, `mantenimiento` y `pendiente_devolucion`.
- `reservada` no debe ofrecerse como estado manual si es un estado derivado de una reserva activa.
- Los cambios deben respetar los permisos de administrador y persistir en modo API.
- La ubicacion, el responsable y los tickets relacionados deben actualizarse segun las reglas ya existentes.
- Un usuario no administrador no puede cambiar estados.

### 7. Espera para retirar

- No debe existir una validacion que obligue a que la hora de retiro sea al menos 30 minutos posterior al momento actual.
- La eliminacion aplica a reservas individuales de alumnos, reservas individuales de profesores y lotes de profesores.
- Deben conservarse las validaciones de ano, fecha no pasada, dias habiles y horario permitido.

## Archivos y componentes afectados

- `index.html`
  - renderizado de Mis prestamos y Tu actividad;
  - gestion de preferencias;
  - flujo de tickets y accion de habilitar notebook;
  - baneo y listado de tardanzas;
  - selector y cambio de estados de inventario;
  - validacion y controles de reservas.
- `backend/server.js`
  - preferencias;
  - actualizacion de notebooks;
  - tickets y sincronizacion al habilitar;
  - baneo por legajo;
  - validaciones de reservas.
- `database/schema.sql`
  - solo si la implementacion requiere una restriccion adicional. No se preve migracion para el alcance actual.
- `documentacion-netmo.txt`
  - actualizar solo para describir el comportamiento finalmente implementado y validado.

## Reglas de permisos

- Alumno y profesor: pueden consultar sus prestamos, reservas, tickets y preferencias; no pueden modificar tickets, inventario ni baneos.
- Administrador: puede cambiar estados de tickets, confirmar devoluciones, habilitar notebooks, modificar estados de inventario y banear/desbanear alumnos o profesores.
- Administrador: no puede ser baneado mediante el endpoint de usuarios.

## Errores esperados

- Reserva fuera del ano actual: respuesta `400` con mensaje en espanol.
- Cambio de estado de notebook no valido: respuesta `400` o rechazo de interfaz sin enviar la solicitud.
- Preferencias invalidas: respuesta `400` y mensaje visible sin confirmar guardado.
- Baneo de legajo inexistente o administrador: respuesta `404` o `403` segun el caso.
- Operacion administrativa sin permisos: respuesta `403`.
- Ticket o notebook inexistente: respuesta `404`.

## Criterios de aceptacion

- CA-01: despues de solicitar una devolucion, Inicio y Mis prestamos muestran estado pendiente y no muestran el equipo como deuda activa con vencimiento del dia.
- CA-02: al confirmar la devolucion, el prestamo desaparece de los prestamos activos y la notebook queda disponible o en mantenimiento segun corresponda.
- CA-03: un administrador puede pasar un ticket a `resuelto`; el ticket desaparece de Fallas reportadas y el contador se actualiza.
- CA-04: al habilitar una notebook desde Fallas reportadas con API activa, la notebook y el ticket quedan actualizados en PostgreSQL y siguen actualizados despues de recargar.
- CA-05: un administrador puede banear a cualquier usuario elegible por legajo, no solo a Teo; el usuario baneado no puede iniciar sesion.
- CA-06: desbanear un usuario persistido permite iniciar sesion nuevamente.
- CA-07: no se puede banear a un administrador.
- CA-08: una fecha de reserva de otro ano se rechaza en interfaz, API y base de datos.
- CA-09: una fecha valida del ano actual funciona para alumno, profesor y lote sin exigir 30 minutos de anticipacion.
- CA-10: las preferencias cargadas desde API aparecen correctamente y un cambio permanece despues de cerrar y volver a iniciar sesion.
- CA-11: Preferencias no contiene una segunda accion de cierre de sesion.
- CA-12: Inventario no ofrece `reservada` como estado manual y permite cambiar los cuatro estados soportados por la base de datos cuando el usuario es administrador.
- CA-13: una cuenta alumno o profesor recibe `403` al intentar modificar tickets, notebooks o baneos.
- CA-14: demo y API muestran resultados equivalentes para los flujos cubiertos.

## Estrategia de validacion

1. Validacion estatica: `node --check backend/server.js` y comprobacion de que no existan estados UI fuera del enum de PostgreSQL.
2. Pruebas manuales en modo demo con un alumno, un profesor y un administrador.
3. Pruebas manuales con PostgreSQL activo para devolucion, ticket, baneo, preferencias e inventario.
4. Pruebas de permisos con tokens de alumno, profesor y administrador.
5. Pruebas de persistencia recargando la pagina y reiniciando sesion.
6. Pruebas de regresion de reservas para alumno, profesor y lote, incluyendo una fecha fuera del ano actual y una hora inmediata valida.
7. Actualizacion de la documentacion solo despues de validar los criterios de aceptacion.

## Riesgos y decisiones pendientes

- El modo demo no persiste datos despues de recargar; su criterio es consistencia durante la sesion.
- La accion "habilitar" debe definirse como una operacion atomica en API para evitar que la notebook quede disponible con un ticket abierto.
- Se decide ocultar la frase de deuda activa durante una devolucion pendiente; la interfaz muestra que la devolucion fue informada y espera confirmacion fisica.
- Se decide no mostrar el vencimiento en el detalle de un prestamo pendiente, para evitar que se interprete como una deuda vigente.
- No se requiere migracion de esquema salvo que las pruebas descubran una incompatibilidad con los estados o vistas existentes.

## Plan de implementacion posterior a la aprobacion

1. Corregir primero la sincronizacion API de tickets/notebooks, preferencias y baneo.
2. Ajustar la vista de devolucion pendiente y retirar el mensaje de vencimiento activo.
3. Eliminar `reservada` del selector manual y validar estados contra una lista compartida compatible con la base.
4. Verificar reservas y ausencia de espera de 30 minutos en ambos modos.
5. Ejecutar las pruebas especificas de cada criterio y actualizar documentacion.
6. Revisar el diff final y dejar registrados los criterios no cubiertos por automatizacion.
