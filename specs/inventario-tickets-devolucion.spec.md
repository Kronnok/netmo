# Especificación: inventario, tickets y devoluciones

## Estado

Aprobada por el dueño del proyecto para implementación.

## Objetivo y alcance

Corregir los contadores de respuestas, agregar una respuesta automática al crear
un ticket y permitir que su dueño sume información. Administración conserva la
posibilidad de responder y actualizar el estado. También se mejora la interfaz
de inventario. Revisar por lectura las rutas de devolución; si no se verifica un
defecto, limitar el cambio a un mensaje claro ante errores 5xx. Sin cambios de
endpoints de inventario ni dependencias nuevas. Se agrega una migración mínima
para que la respuesta automática pueda guardarse sin un autor humano.

## Comportamiento actual y esperado

- El contador global puede alterar el límite y duplicar el contador de respuestas.
  Debe quedar un único contador 0/500 en la caja de respuesta.
- Al crear un ticket, el sistema registra una respuesta automática de NetMO con
  el acuse de recibo. El dueño puede responder para agregar información y el
  administrador puede responder cuando corresponda. Cualquier otro rol recibe
  403. Las respuestas no reabren el ticket.
- El modal del dueño permite escribir, muestra el hilo completo y señala las
  respuestas administrativas no leídas. El administrador conserva la vista
  completa de todos los tickets.
- El inventario usa formularios y tablas que pueden desbordarse y algunos
  controles no conservan el estilo del tema. Se espera diseño adaptable, campos
  legibles en ambos temas y contador de ubicación sincronizado con su campo.
- La lógica de devolución se mantiene salvo defecto verificable por lectura;
  errores 5xx mostrarán un mensaje de reintento claro.

## Archivos afectados

- `frontend/app.js`, `frontend/index.html`, `frontend/styles.css`
- `backend/services/api-service.js` y pruebas backend relacionadas
- `backend/test/server.test.js`
- `database/migrations/014-ticket-automatic-replies.sql`, `database/schema.sql`
- `specs/inventario-tickets-devolucion.spec.md`

## Criterios de aceptación

1. El textarea de respuesta mantiene `maxlength=500` y un único contador 0/500;
   los otros campos conservan un único contador y límites coherentes.
2. POST de respuestas acepta al dueño del ticket y a administración; rechaza con
   403 a cualquier otro rol y no reabre tickets. GET sigue autorizado para el
   dueño y admin; el modal del dueño permite responder y marca respuestas
   administrativas no leídas.
3. `createTicket` guarda una respuesta automática de NetMO. La migración 014
   vuelve opcional `ticket_replies.author_id` para que esa respuesta no dependa
   de una cuenta humana.
4. Las secciones de inventario usan campos tematizados, formularios de dos
   columnas que colapsan a una, tablas legibles con scroll interno en móvil,
   acciones alineadas, contador de ubicación funcional y mensajes vacíos claros.
   No cambian lógica ni endpoints de inventario.
5. Los cambios no agregan dependencias; las pruebas se ejecutan antes y después,
   con las pruebas que requieren PostgreSQL omitidas cuando no hay base de
   pruebas configurada.
