# Especificación: mostrar u ocultar la contraseña del login

## Objetivo y alcance

Agregar un control accesible para alternar la visibilidad de la contraseña
escrita en el formulario de inicio de sesión. El cambio se limita a la interfaz
existente del login y no modifica autenticación, validación de credenciales,
backend, base de datos ni otros flujos de contraseña.

## Comportamiento actual

- El formulario de login está en `frontend/index.html`; su campo
  `#loginPassword` comienza con `type="password"`.
- Otros formularios ya usan `type="button"` para controles de contraseña, y
  `frontend/styles.css` contiene los estilos de campos y botones.
- El envío del login se realiza mediante el submit existente y
  `login(event)` en `frontend/app.js`.
- No se encontraron `CONTEXT.md` ni `documentacion-netmo.txt`; se revisó
  `PROYECTO.md` para confirmar la arquitectura y el flujo de login documentados.

## Comportamiento esperado

- Mostrar un botón con ícono de ojo dentro del campo de contraseña, alineado a
  la derecha y usable con mouse, teclado y dispositivos móviles.
- El estado inicial es oculto y muestra el ojo tachado; al activar el botón, el
  valor permanece intacto, el campo se vuelve visible y el ícono pasa a ojo
  abierto. Al activarlo nuevamente, se oculta.
- El botón no envía el formulario ni recarga la página.
- `aria-label` describe la acción disponible (mostrar u ocultar contraseña) y
  se actualiza al alternar.
- Se conservan el diseño, los colores, bordes y estilos actuales del login.

## Archivos previstos

- `frontend/index.html`: incluir el control de visibilidad dentro del campo.
- `frontend/styles.css`: integrar y dimensionar el control visualmente dentro
  del campo, con foco visible.
- `frontend/app.js`: alternar el tipo del campo y el estado accesible e
  iconográfico, sin cambiar `login(event)` ni la autenticación.
- `specs/login-password-visibility.spec.md`: documentar el alcance y criterios.

## Criterios de aceptación

1. La contraseña está oculta al cargar el formulario.
2. Activar el botón muestra la contraseña y el ojo abierto.
3. Activarlo nuevamente oculta la contraseña y muestra el ojo tachado.
4. El valor escrito se conserva en ambos cambios.
5. El botón tiene `type="button"` y no envía ni recarga el formulario.
6. La acción es accesible y su `aria-label` refleja el estado siguiente.
7. El inicio de sesión conserva su flujo existente; no se modifican API,
   autenticación ni persistencia.

## Validación

Revisar el diff y comprobar el comportamiento de alternancia y el tipo de botón
mediante una prueba dirigida. Ejecutar las pruebas existentes pertinentes si
están disponibles.
