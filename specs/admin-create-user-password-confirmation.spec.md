# Alta de usuarios: visibilidad y confirmación de contraseña

## Estado

Aprobada e implementada.

## Objetivo y alcance

Mejorar exclusivamente el formulario administrativo de alta de alumnos y
profesores y su validación en `POST /api/admin/users`. Añadir confirmación de
contraseña y controles independientes para mostrar u ocultar ambos campos.

No modificar autenticación, roles, permisos, esquema de base de datos ni otros
formularios. No cambiar las reglas actuales de longitud y formato de la
contraseña.

## Comportamiento actual observado

- `frontend/index.html` contiene `#adminUserForm` y un único campo
  `#userPassword`; el formulario usa `novalidate`.
- `frontend/app.js` valida la contraseña antes de enviar `{ nombre, apellido,
  email, dni, rol, password }` a `POST /api/admin/users`.
- `backend/services/api-service.js` valida la contraseña con
  `accountPassword`, almacena solo `crypt($5, gen_salt('bf'))` y devuelve
  columnas que no incluyen la contraseña.
- La visibilidad de la contraseña del login ya usa botones accesibles e iconos
  SVG; `frontend/styles.css` contiene sus estilos.
- `reportes y cosas extra/documentacion-netmo.txt` documenta el uso de hash con
  `pgcrypto`/`crypt()`. No se encontró `CONTEXT.md`.

## Comportamiento esperado

- Agregar debajo de la contraseña un campo obligatorio «Confirmar contraseña»
  con dimensiones y estilo equivalentes.
- Cada campo tendrá un botón de ojo independiente, con estado accesible e icono
  que refleje si el texto está visible. Alternar el tipo del input no borrará
  ni cambiará su valor.
- Antes de enviar el formulario, el frontend verificará que ambos campos estén
  completos y coincidan. Si no coinciden, mostrará «Las contraseñas no
  coinciden» debajo de la confirmación y no enviará ninguna solicitud.
- La coincidencia se volverá a evaluar cuando cambie cualquiera de los dos
  valores; el error se retirará al corregirse.
- El backend comprobará que la confirmación exista y coincida con `password`.
  Una confirmación ausente o distinta se rechazará con HTTP 400 antes de
  insertar datos. La solicitud incluirá `passwordConfirmation`.
- El hash actual, la respuesta sin contraseñas y las reglas de autenticación
  permanecerán sin cambios. No se añadirán logs que contengan contraseñas.

## Archivos y superficies previstos

- `frontend/index.html`: campo, botones e iconos dentro del formulario
  administrativo.
- `frontend/app.js`: controles independientes de visibilidad y validación del
  formulario antes de `apiRequest`.
- `frontend/styles.css`: estilos de los controles y del mensaje junto al campo
  de confirmación, reutilizando el patrón existente.
- `backend/services/api-service.js`: comparación en `createUser` antes de
  abrir la transacción o insertar.
- `backend/test/security-and-business-rules.test.js` y pruebas de interfaz/API
  existentes: casos de coincidencia, falta de confirmación, diferencia, no
  exposición y preservación del hash/inicio de sesión.
- `reportes y cosas extra/documentacion-netmo.txt`: documentar la confirmación
  en el flujo de alta, sin describir cambios de autenticación.

## Errores, seguridad y compatibilidad

- Confirmación vacía o contraseña vacía: bloquear el alta; el backend también
  rechazará la solicitud.
- Valores distintos: mensaje exacto «Las contraseñas no coinciden» y HTTP 400
  en solicitudes directas al backend.
- La contraseña confirmada no se almacenará, ni en claro ni como campo
  separado; solo se mantendrá el hash actual.
- No incluir contraseñas ni confirmaciones en respuestas o logs.
- No cambiar tablas, roles, permisos, autenticación ni campos de otras vistas.

## Criterios de aceptación verificables

1. Contraseñas iguales y válidas permiten completar el alta.
2. Contraseñas distintas impiden el envío en frontend y muestran el mensaje
   debajo de la confirmación.
3. La confirmación vacía impide el envío en frontend.
4. Cambiar cualquiera de los valores después de coincidir vuelve a detectar la
   diferencia; corregirla permite continuar.
5. Cada botón alterna solo su campo entre visible y oculto, conserva el valor y
   actualiza su icono/etiqueta accesible.
6. Una solicitud directa con confirmación ausente o distinta es rechazada por
   el backend con HTTP 400 y no crea usuario.
7. El alta válida conserva el hash `crypt(..., gen_salt('bf'))`; las respuestas
   no contienen contraseña ni confirmación.
8. Una cuenta creada puede iniciar sesión con su contraseña original mediante
   el mecanismo existente.
9. No hay migraciones ni cambios a otros formularios, autenticación, roles o
   permisos. Las pruebas pertinentes pasan.
