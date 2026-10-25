# Especificación: corrección del login y comparación de credenciales

## Objetivo y alcance

Corregir y probar el login para que usuarios con credenciales válidas puedan
autenticarse sin que las reglas de creación/cambio de contraseña alteren la
clave introducida. La verificación debe comparar el email sin distinguir
mayúsculas y el limitador debe contar únicamente contraseñas incorrectas, no
bloquear inicios de sesión correctos ni conservar fallos después de un éxito.

No se modifican el formato ni el hash de las contraseñas ya almacenadas, ni se
añaden migraciones, dependencias o cambios de interfaz.

## Comportamiento actual observado

- `login` valida que la clave sea una cadena y la compara con
  `password_hash = crypt($2, password_hash)`. No llama a la validación de clave
  nueva ni aplica `trim` u otra transformación.
- `accountPassword`, usada al crear cuentas, exige al menos ocho caracteres y
  rechaza espacios. La creación entrega la clave original a `crypt`.
- `accountEmail` convierte el email recibido a minúsculas y `users.email` usa
  el tipo PostgreSQL `CITEXT`, por lo que las consultas `email = $1` comparan
  sin distinguir mayúsculas.
- El limitador consulta el estado antes del login, registra solo cuando no hay
  coincidencia de credenciales y limpia los fallos tras un login aceptado.
- La ruta `POST /api/auth/login` delega en el servicio de autenticación.

## Comportamiento esperado

1. Crear una cuenta continúa aplicando las reglas de clave nueva y guardando
   exactamente la cadena recibida, sin transformación adicional.
2. El login acepta cualquier clave de tipo cadena que coincida con el hash,
   incluso si no cumple las reglas actuales para crear o cambiar una clave.
   La comparación utiliza `crypt(password, password_hash)` con la clave
   recibida sin `trim`, normalización ni otra transformación.
3. El email recibido y el almacenado se comparan sin distinguir mayúsculas,
   tanto en la búsqueda de credenciales como en el manejo de baneos vencidos.
4. El limitador registra fallos de credenciales incorrectas; no registra ni
   bloquea un login correcto y limpia los fallos tras autenticar correctamente.
   Se conserva el límite vigente de cinco fallos en quince minutos.
5. La ruta HTTP conserva los estados y respuestas de error actuales para
   credenciales incorrectas y exceso de intentos.

## Archivos y módulos previstos

- `backend/services/auth-service.js`: comparación de email y contraseña;
  interacción con el limitador.
- `backend/services/login-rate-limiter.js`: solo si las pruebas muestran que
  el conteo o desbloqueo no cumple el comportamiento esperado.
- `backend/test/security-and-business-rules.test.js` y/o el arnés de
  integración existente: pruebas de regresión.
- `backend/routes.js` y `backend/controllers/api-controller.js`: verificar el
  enrutamiento actual; modificar únicamente si se demuestra un defecto ahí.

## Criterios de aceptación

1. Una cuenta creada por el flujo de alta con una clave de ocho caracteres
   puede iniciar sesión con esa misma clave.
2. El login con una clave incorrecta falla con el error de credenciales
   esperado.
3. Un email cuya capitalización difiera de la almacenada puede iniciar sesión.
4. La clave llega sin recortes ni transformaciones diferentes entre alta y
   verificación.
5. Un login correcto no aumenta los fallos del limitador y limpia fallos
   anteriores; cinco fallos sí producen el bloqueo vigente.
6. Pasan las pruebas pertinentes y se informa `git diff --stat`.

## Riesgos y validación

- `CITEXT` ya resuelve la comparación de mayúsculas y minúsculas y conserva el
  índice único existente; no hace falta alterar el SQL ni migrar el esquema.
- No mostrar ni registrar contraseñas, hashes, tokens ni otros secretos en la
  salida de pruebas o del informe.
- Ejecutar las pruebas backend pertinentes y, si el entorno de base de datos
  está disponible, el arnés de integración existente.
