# Especificación: diagnóstico y errores de conexión del login

## Objetivo y alcance

Corregir el mensaje genérico de conexión fallida del login y cubrir los
diagnósticos solicitados de configuración, CORS, rutas y arranque de la API.
El cambio se limita a la configuración CORS del backend, sus pruebas y el
frontend del login. No modificar la base remota ni la configuración de Render.

## Comportamiento actual observado

- `frontend/config.js` apunta a `https://netmo-api.onrender.com`, sin ruta ni
  barra final. `app.js` elimina barras finales de la base y concatena rutas que
  empiezan con `/api`; el endpoint de salud usa `/health`.
- `backend/config.js` recorta espacios y admite varios orígenes separados por
  comas, pero no quita barras finales.
- `backend/server.js` responde `OPTIONS` con 204 y agrega headers CORS también a
  las respuestas de error; un origen no permitido no recibe
  `Access-Control-Allow-Origin`.
- `routes.js` contiene `/api/auth/login`, `/api/auth/refresh`, `/api/carros` y
  `/api/me`.
- `warmApiAndRestoreSession` consulta `/health` al abrir la página, pero expone
  errores de red sin traducir. `login` también muestra directamente
  `error.message` y no limita ni reintenta la petición.
- `render.yaml` declara `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` y variables
  de correo. El servidor requiere las tres primeras al arrancar; el pool
  requiere que exista `DATABASE_URL`. El servidor no ejecuta migraciones al
  arrancar.

## Comportamiento esperado

1. Normalizar cada valor `CORS_ORIGIN` quitando espacios y barras finales,
   admitir listas separadas por comas y conservar el rechazo de orígenes no
   autorizados.
2. El preflight de un origen autorizado devuelve 204 con Allow-Origin,
   Allow-Methods y Allow-Headers correctos; las respuestas 4xx y 5xx mantienen
   los headers CORS. El origen no autorizado no recibe Allow-Origin.
3. Las solicitudes de login tienen timeout de 30 segundos, un único reintento
   tres segundos después ante fallos de red/timeout, y muestran un estado de
   conexión durante la espera. Los errores HTTP muestran el mensaje de la API.
4. Los errores de red o timeout se traducen a un mensaje claro y nunca incluyen
   el texto crudo de Fetch, contraseñas ni tokens.
5. El GET `/health` se dispara al abrir la página sin bloquear el formulario ni
   mostrar errores crudos de Fetch. La restauración de una sesión guardada
   continúa siendo independiente.
6. La configuración de producción inicia con las variables requeridas
   declaradas en `render.yaml`; el backend no conecta ni migra la base durante
   el arranque, y `/health` comprueba la conexión al ejecutar `SELECT 1`.

## Archivos previstos

- `backend/config.js`: normalización de orígenes CORS.
- `backend/test/server.test.js`: regresión de preflight autorizado/no
  autorizado y headers en errores.
- `backend/test/security-and-business-rules.test.js`: mantener la aserción
  estática del calentamiento `/health` ante el nuevo signal de timeout.
- `frontend/app.js`: calentamiento independiente, timeout y reintento del login,
  mensajes seguros.
- `frontend/index.html`: estado accesible del login.
- `specs/login-fetch-diagnostics.spec.md`: criterios y límites del cambio.

## Criterios de aceptación

1. La URL de producción y la composición de rutas no contienen localhost,
   rutas duplicadas, barras dobles ni placeholders.
2. El servidor acepta orígenes configurados con espacios, listas y barras
   finales; rechaza otros orígenes en CORS.
3. Pruebas automáticas verifican el preflight requerido, el origen no permitido
   y headers CORS para errores 4xx/5xx.
4. El login espera hasta 30 segundos por intento, reintenta una sola vez tras
   tres segundos ante errores de red y muestra mensajes comprensibles.
5. El calentamiento de `/health` no impide usar el login y no revela errores
   crudos.
6. `npm test` pasa con, como mínimo, la línea base actual.
7. El diagnóstico local de producción usa solo valores dummy; no se contacta la
   base remota ni se imprimen secretos.

## Riesgos y validación

- No se puede verificar la configuración efectiva de Render, la conectividad
  externa ni el estado de migraciones de la base remota sin acceso a esos
  recursos.
- Ejecutar la suite y un preflight `curl` local del servidor en modo producción
  con variables dummy y el origen de Pages indicado por el usuario.
- Revisar `git diff --check` y `git diff --stat`.
