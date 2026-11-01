# Especificación: integración segura y smoke de NetMO

## Objetivo

Probar API y frontend con pruebas unitarias y una base PostgreSQL explícitamente
aislada para pruebas, sin conectarse a producción.

## Alcance

- Las pruebas unitarias se ejecutan siempre. Las de integración requieren
  `TEST_DATABASE_URL`, rechazan ausencia o igualdad con `DATABASE_URL`, y
  además exigen una DB local o un nombre de DB que identifique entorno test.
- Los tests cubren autorización para rutas autenticadas, flujos principales de
  reservas/préstamos/devoluciones/tickets/inventario, contraseñas y backup/
  restore. La integración aplica migraciones y reemplaza los datos únicamente
  en la DB de test identificada.
- `npm run smoke` ejecuta la API en un puerto libre contra esa DB aislada,
  recorre los flujos principales con admin, profesor y alumno, e imprime
  resultado por paso.
- Chequeos estáticos verifican sintaxis JS, interpolaciones de `innerHTML`,
  referencias no permitidas y URLs localhost del frontend.
- Sin URL segura de integración, tests unitarios y chequeos estáticos pasan y
  la integración se informa como omitida; nunca se usa `DATABASE_URL` como
  sustituto.

## Aceptación

1. No existe ruta del runner que conecte a una DB cuando falte o no sea segura
   `TEST_DATABASE_URL`.
2. Los tests y smoke describen claramente resultados y causas de error sin
   mostrar URLs ni secretos.
3. Ningún test integra con producción ni ejecuta restauraciones fuera de la
   DB explícitamente aislada.
