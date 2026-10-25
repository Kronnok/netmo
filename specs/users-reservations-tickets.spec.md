# Especificación: tickets, límites de texto y reservas

## Estado

Aprobada por el dueño del proyecto para implementación.

Esta especificación reemplaza cualquier alcance anterior contradictorio en
este archivo. No incluye cambios de esquema ni migraciones.

## Alcance y comportamiento esperado

### A. Fallas reportadas

- En la cola administrativa, cada ticket tendrá un selector con Abierto,
  En progreso y Resuelto, reutilizando el selector de estados de Inventario,
  con estado actual seleccionado; retirar los botones individuales y permitir
  reabrir tickets resueltos.
- Guardar cada cambio mediante `PATCH /api/tickets/:codigo`; solo admin puede
  actualizar y el backend acepta únicamente `abierto`, `progreso` y `resuelto`.
- Resolver registra actor y fecha y devuelve a disponible únicamente una
  notebook asociada que esté en mantenimiento. Reabrir limpia esos metadatos y
  no cambia automáticamente la notebook.
- Confirmar visualmente el guardado. “Mis tickets” consultará la API al entrar
  y después de cada acción.

### B. Límite global de texto

- Máximo 50 caracteres para todos los inputs y textareas de texto, incluyendo
  nombres, apellido, email, legajo, curso/división, motivos, descripción de
  fallas, búsquedas, contraseñas, carros, notebooks y otros campos de texto.
- Frontend: `maxlength=50` y contador visible en campos de texto libre.
- Backend: recortar extremos, rechazar vacío/solo espacios y responder 400
  con mensaje claro cuando se excedan 50 caracteres. Aplicar a datos de entrada
  nuevos y cambios. Para preservar cuentas previas, el email y la contraseña
  del login no se limitan ni se validan por longitud en frontend o backend.
- Excluir fechas, horas, cantidades, selectores, campos no textuales y archivos
  de backup. No imponer restricciones de BDD ni invalidar filas existentes.

### C. Reservas por carro

- `GET /api/carros` requiere autenticación y está disponible para cualquier rol
  autenticado. Devuelve carros y cantidad de notebooks disponibles.
- Alumnos y profesores elegirán carro en el formulario; indicar disponibilidad
  y deshabilitar carros con cero unidades. Cargar al abrir Reservas; ante error,
  mostrarlo y permitir reintentar, sin dejar el selector vacío.
- Asignar notebooks disponibles solo del carro elegido, dentro de la
  transacción, en reservas individuales y lotes. Disponibilidad insuficiente:
  HTTP 409 claro, sin reserva ni asignación parcial.

### D. Curso/división

- El curso de profesores cumple `^[1-7]°(?:[1-9]|[1-9]\d)°$`.
- La interfaz tendrá dos campos numéricos (Año y División) y formará
  automáticamente el valor, por ejemplo `2°14°`.
- El backend rechaza formato inválido con HTTP 400. No alterar filas existentes.

### E. Pruebas y documentación

- Añadir o ajustar pruebas de A-D, actualizar la documentación funcional y
  ejecutar la suite completa. Corregir fallas relacionadas.
- No introducir dependencias nuevas ni acceder/modificar la BDD remota.

## Criterios de aceptación

1. Los estados se pueden cambiar y reabrir desde el selector; actor/fecha se
   conservan al resolver, se limpian al reabrir y solo se libera notebook en
   mantenimiento al resolver. Mis tickets se refresca al entrar y tras acciones.
2. Todos los inputs/textareas de texto auditados, excepto los dos campos de
   login por compatibilidad con cuentas existentes, tienen máximo 50 en UI;
   los campos de texto libre muestran contador. Backend devuelve 400 para
   texto de más de 50 o solo espacios, excepto las credenciales del login.
3. Usuarios autenticados de cualquier rol consultan disponibilidad por carro;
   reserva individual y lote asignan exclusivamente dentro del carro elegido,
   o fallan con 409 sin efectos parciales.
4. Curso válido acepta el patrón indicado; inválido responde 400 y UI lo genera
   con Año/División numéricos.
5. Pruebas específicas y suite completa pasan; documentación describe el
   comportamiento. Sin migraciones ni restricciones nuevas de BDD.

## Archivos previstos

- `frontend/index.html`, `frontend/app.js`
- `backend/routes.js`, `backend/services/validation.js`,
  `backend/services/api-service.js`, pruebas backend
- `reportes y cosas extra/documentacion-netmo.txt`
