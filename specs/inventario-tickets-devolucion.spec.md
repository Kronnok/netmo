# Especificación: inventario, tickets y devoluciones

## Estado

Aprobada por el dueño del proyecto para implementación.

## Objetivo y alcance

Corregir los contadores de respuestas, hacer las respuestas de tickets exclusivas
de administración y mejorar la interfaz de inventario. Revisar por lectura las
rutas de devolución; si no se verifica un defecto, limitar el cambio a un
mensaje claro ante errores 5xx. Sin migraciones, cambios de endpoints de
inventario ni dependencias nuevas.

## Comportamiento actual y esperado

- El contador global puede alterar el límite y duplicar el contador de respuestas.
  Debe quedar un único contador 0/500 en la caja de respuesta administrativa.
- Los dueños pueden responder y reabrir tickets. Solo admin podrá responder;
  dueños y admin conservarán acceso de lectura. El modal del dueño será de solo
  lectura y señalará respuestas administrativas no leídas.
- El inventario usa formularios y tablas que pueden desbordarse y algunos
  controles no conservan el estilo del tema. Se espera diseño adaptable, campos
  legibles en ambos temas y contador de ubicación sincronizado con su campo.
- La lógica de devolución se mantiene salvo defecto verificable por lectura;
  errores 5xx mostrarán un mensaje de reintento claro.

## Archivos afectados

- `frontend/app.js`, `frontend/index.html`, `frontend/styles.css`
- `backend/services/api-service.js` y pruebas backend relacionadas
- `backend/test/server.test.js`
- `specs/inventario-tickets-devolucion.spec.md`

## Criterios de aceptación

1. El textarea de respuesta mantiene `maxlength=500` y un único contador 0/500;
   los otros campos conservan un único contador y límites coherentes.
2. POST de respuestas rechaza con 403 todo rol distinto de admin y no reabre
   tickets. GET sigue autorizado para el dueño y admin; el modal del dueño no
   permite escribir y marca respuestas administrativas no leídas.
3. Las secciones de inventario usan campos tematizados, formularios de dos
   columnas que colapsan a una, tablas legibles con scroll interno en móvil,
   acciones alineadas, contador de ubicación funcional y mensajes vacíos claros.
   No cambian lógica ni endpoints de inventario.
4. Los cambios no agregan migraciones ni dependencias; las pruebas se ejecutan
   antes y después, con las pruebas que requieren PostgreSQL omitidas cuando no
   hay base de pruebas configurada.
