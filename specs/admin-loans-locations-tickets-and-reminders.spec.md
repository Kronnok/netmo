# Especificación: inventario, circulación, recordatorios y respuestas de tickets

## Estado

Aprobada por el requerimiento del propietario. Última migración aplicada: 010.
Crear migraciones nuevas desde 011; nunca modificar migraciones aplicadas ni
conectar a la base remota.

## Objetivo y restricciones

Completar los nueve flujos funcionales indicados para carros, ubicaciones,
bloqueo de acceso, DNI, tickets, préstamos, mantenimiento, recordatorios y
respuestas. Añadir pruebas focalizadas, actualizar `README.md`, `DEPLOY.md` y
`PROYECTO.md`. No añadir dependencias. El fallo de correo no cancela ninguna
operación de negocio; cada envío se protege con `try/catch`.

## Comportamiento esperado y criterios de aceptación

1. **Carros:** borrar un carro con notebooks da 409 e informa la cantidad, nunca
   500 por `notebooks_carro_id_fkey`. Inventario permite moverlas a otro carro y
   borrar en una transacción. Si está vacío, confirmar y borrar directamente.
   Una prueba reproduce la FK.
2. **Ubicaciones:** migración 011 crea `ubicaciones(slug PK, nombre)`, siembra
   los cuatro slugs y etiquetas existentes, reemplaza el CHECK de carros por FK
   nullable, y `schema.sql` representa el esquema final. Endpoints admin GET,
   POST, PATCH y DELETE; los nombres se recortan, miden 2–50 caracteres y
   generan slugs únicos. DELETE en uso responde 409. Inventario permite crear,
   renombrar y eliminar; reservas y carros cargan ubicaciones desde API.
3. **Bloqueo:** `LOGIN_LOCK_MINUTES` define la ventana (default 2, mínimo 1),
   manteniendo cinco fallos máximos. La misma ventana aplica a login,
   recuperación y reset/cambio; las respuestas 429 informan los minutos
   restantes, y la solicitud de recuperación conserva respuesta genérica.
   Variable en `.env.example`
   y `render.yaml`; pruebas cubren mínimo, default y límite.
4. **DNI:** nuevas altas aceptan 7–10 dígitos, con el mismo error en backend y
   frontend; input, pruebas y documentación alineados. No modificar cuentas
   existentes.
5. **Tickets:** el formulario lista notebooks distintas del historial de
   préstamos del usuario, más reciente primero, con código y fecha del último
   uso, y ofrece «Otra / no sé». El API valida existencia; no-admin solo puede
   asociar notebook de su historial (400 en otro caso).
6. **Préstamos y devoluciones:** solo admin registra entrega/devolución.
   - El usuario no ve ni usa solicitud de devolución; se conserva el endpoint
     heredado. Sus préstamos activos informan que la devolución la registra
     administración, vencimiento y cuenta regresiva.
   - Admin registra entrega por reserva; lotes pendientes se aprueban y entregan
     transaccionalmente. Reutiliza asignaciones y completa unidades faltantes
     con disponibles; insuficiencia responde 409 sin efectos parciales.
   - `POST /api/admin/loans/:id/return` valida admin, acepta préstamos activos
     y heredados en devolución pendiente, registra receptor y hora Buenos Aires,
     cierra el préstamo, registra demora si vencido y libera notebook a
     mantenimiento si hay ticket abierto/en progreso; en caso contrario,
     disponible. Repetir responde 409. La confirmación heredada continúa.
   - Búsquedas admin por `q` de hasta 50 caracteres para préstamos y reservas
     pendientes: coincidencia parcial sin acentos ni diferencias de mayúsculas
     sobre nombre, apellido, correo, DNI y código; máximo 50 resultados con los
     campos requeridos. Parámetros SQL, escape de comodines.
   - Vista «Entregas y devoluciones»: búsqueda con debounce 300 ms, mínimo dos
     caracteres, acciones individuales o por lote, mora resaltada, confirmación
     y actualización tras acciones y cada 30 segundos.
   - Correos de entrega/devolución solo según preferencia; errores de correo no
     revierten operación.
   - Pruebas de permisos, búsquedas, devolución/estado de notebook/demora,
     idempotencia y flujo de punta a punta.
7. **Mantenimiento por tickets:** crear ticket o pasar a progreso pone en
   mantenimiento solo notebooks disponibles; al devolver una notebook con ticket
   activo, pasa a mantenimiento. Resolver el último ticket activo libera solo
   notebooks en mantenimiento. Preservar casts `ticket_status` y `bigint`.
8. **Recordatorios:** UI avisa en Inicio y Mis préstamos dentro de
   `return_reminder_minutes` (0 desactiva), con refresco cada 60 segundos.
   Migración añade `loans.reminder_sent_at`. POST `/api/internal/reminders`
   compara `x-cron-secret` con `CRON_SECRET` en tiempo constante, exige secreto
   en producción y responde 401 si no coincide. Procesamiento de préstamos
   activos elegibles, respetando preferencia y marca idempotente. Configuración
   en `.env.example` y `render.yaml`; `DEPLOY.md` documenta cron externo gratuito
   cada cinco minutos y advierte que Render gratuito se duerme.
9. **Respuestas de tickets:** migración crea `ticket_replies` con las columnas
   pedidas. GET/POST replies permiten dueño o admin, y rechazan otros con 403.
   Mensaje trim, no vacío y máximo 500. Admin responde y se notifica al dueño
   solo si corresponde; errores de correo no cancelan. UI en Mis tickets y
   Admin > Fallas refresca al abrir/enviar, cuenta caracteres y escapa todos
   los datos. Ticket resuelto acepta respuesta; solo respuesta del dueño lo
   reabre y vuelve a poner en mantenimiento una notebook disponible asociada.
10. Tests específicos para cada punto, casos límite para 3, 4, 7 y 8, suite
    completa igual o mejor a la línea base; documentación funcional/de despliegue
    actualizada. Al cierre informar diff, estado por punto y si ejecutar
    `npm run db:migrate`. Crear commit sin push ni `--force`.

## Archivos y componentes previstos

- `backend/routes.js`, controladores y servicios de API/autenticación
- `backend/services/login-rate-limiter.js` y `validation.js`
- `backend/test/`
- `frontend/app.js`, `frontend/index.html`
- `database/migrations/011-*.sql`, `database/schema.sql`
- `.env.example`, `render.yaml`, `README.md`, `DEPLOY.md`, `PROYECTO.md`

## Validación y seguridad operacional

- Ejecutar `git status`, revisar ausencia de rebase y marcas de conflicto, y
  capturar `npm test` como baseline antes de editar código.
- Usar exclusivamente pruebas aisladas/locales; no leer ni modificar la base
  remota.
- No modificar migraciones 001–010 ni añadir dependencias.
- Instalar dependencias solo si la validación falla por ausencia de paquetes ya
  declarados en los manifiestos.
- Revisar diff y commits; no incluir secretos ni cambios ajenos al alcance.