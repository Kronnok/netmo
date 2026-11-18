# Especificación: simplificar la lista de entregas y devoluciones

## Estado

Implementada según la confirmación del usuario y la imagen adjunta.

## Objetivo

En **Entregas y devoluciones**, mostrar el encabezado general de la página y
únicamente los grupos de préstamos como en la imagen: usuario, selección del
usuario y filas de notebooks con selección individual y acción de devolución.

## Comportamiento esperado

- Conservar el título y subtítulo generales de la página.
- Quitar del contenido de la vista el encabezado duplicado de la tarjeta y los
  controles de búsqueda y filtrado por estado, vencimiento, fecha, motivo,
  usuario, equipo, carro y ubicación.
- Quitar «Limpiar filtros», «Seleccionar todas», «Seleccionar las vencidas»,
  selección por números y la cuenta de resultados.
- Conservar el encabezado de cada usuario, «Seleccionar las de este usuario»,
  cada notebook, su casilla «Seleccionar» y el botón individual para registrar
  la devolución o confirmar su recepción.
- Conservar la selección múltiple: ocultar «Devolver seleccionadas» si no hay
  notebooks marcadas y mostrarlo solo mientras haya una o más seleccionadas.
- Listar los préstamos pendientes mediante el comportamiento predeterminado del
  endpoint actual. No modificar la API ni el envío automático de recordatorios.

## Criterios de aceptación

1. La pantalla coincide con la estructura de la imagen: no presenta filtros,
   barra de herramientas masiva ni encabezado duplicado dentro de la tarjeta.
2. Sin notebooks seleccionadas no aparece el botón flotante de devolución
   múltiple; al marcar una o seleccionar las de un usuario, aparece y funciona.
3. Las acciones individuales de devolución/confirmación siguen disponibles.
4. No se envían filtros persistidos de la versión anterior; el endpoint continúa
   devolviendo préstamos pendientes por defecto.
5. Las pruebas frontend/backend existentes pasan y se actualizan para verificar
   esta estructura.

## Archivos y validación

- `frontend/index.html`, `frontend/app.js`
- `backend/test/security-and-business-rules.test.js`
- Validación con `npm.cmd test --prefix backend` y una prueba local del navegador.
