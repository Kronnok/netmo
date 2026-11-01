# Especificación: fondo visual del login

## Objetivo y alcance

Incorporar `frontend/assets/login-bg.jpg` como fondo decorativo únicamente
durante la autenticación, con una presentación adaptable a escritorio y móvil.
Optimizar la imagen a un máximo de 1600 px de ancho y menos de 250 KB. No se
añaden dependencias ni se modifican archivos del backend.

## Comportamiento actual

- El login se muestra en `#auth-shell`, con una tarjeta centrada y fondo tomado
  del tema.
- Al iniciar sesión, `app.js` agrega la clase `hidden` a `#auth-shell`; al
  cerrar sesión vuelve a mostrarlo.
- La imagen existe en `frontend/assets/login-bg.jpg`, mide 1418×801 y pesa
  728475 bytes.
- Netlify publica `frontend` según `netlify.toml`; Cloudflare Pages se configura
  con `frontend` como raíz estática según `DEPLOY.md`.
- No se encontraron `CONTEXT.md`, `documentacion-netmo.txt` ni `.assetsignore`.

## Comportamiento esperado

- Desde 900 px, usar una composición dividida: imagen decorativa cubriendo
  aproximadamente el 55% izquierdo, marca superpuesta abajo a la izquierda y
  tarjeta centrada sobre el color de fondo del tema en el lado derecho.
- Por debajo de 900 px, cubrir la pantalla con la imagen y una capa oscura de
  aproximadamente 55%; mostrar la tarjeta sobre una superficie translúcida con
  desenfoque cuando esté disponible y un fallback legible sin desenfoque.
- Mantener contraste mínimo 4.5:1 en el contenido de la tarjeta usando las
  variables existentes del tema. Mantener el foco de teclado visible y evitar
  que la tarjeta quede inaccesible en pantallas bajas.
- La foto es decorativa, aparece solo mientras `#auth-shell` está visible y se
  desvanece al cargar. Respetar `prefers-reduced-motion`.
- Pre-cargar la imagen y conservar un color de fondo mientras se muestra.
- Confirmar que el archivo queda dentro del directorio estático publicado por
  Cloudflare Pages y Netlify, sin exclusiones de assets.

## Archivos previstos

- `frontend/index.html`: preload y marca decorativa del panel de imagen.
- `frontend/styles.css`: layout adaptable, contraste, superposición y
  transiciones accesibles.
- `frontend/assets/login-bg.jpg`: versión optimizada de la foto existente.
- `specs/login-background.spec.md`: especificación de este cambio.
- Revisar `netlify.toml`, `DEPLOY.md` y exclusiones de assets; no modificarlos
  si la configuración existente ya sirve la imagen.

## Criterios de aceptación

1. La imagen optimizada mide como máximo 1600 px de ancho y pesa menos de
   250 KB.
2. A 900 px o más, el formulario está en una tarjeta centrada a la derecha y
   la foto con la marca ocupa aproximadamente el 55% izquierdo.
3. Por debajo de 900 px, la foto cubre el fondo, el overlay oscurece la imagen
   y la tarjeta es legible; el blur tiene fallback sin soporte.
4. El fondo desaparece al iniciar sesión sin alterar los flujos existentes de
   ingreso y cierre de sesión.
5. El formulario mantiene contraste y navegación por teclado; las animaciones
   respetan `prefers-reduced-motion`.
6. Netlify y Cloudflare Pages sirven `assets/login-bg.jpg` desde su raíz
   estática configurada.
7. `npm test` pasa y se informa el peso final y `git diff --stat`.

## Riesgos y validación

- La imagen debe conservar su composición y el texto visible de la notebook al
  recortarse con `object-fit: cover`.
- Validar dimensiones y peso del JPEG después de comprimirlo, revisar la
  diferencia de HTML/CSS y ejecutar `npm test`.
