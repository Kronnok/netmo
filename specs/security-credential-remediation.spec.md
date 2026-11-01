# Especificación: saneamiento de integración y verificación de despliegue

## Objetivo y alcance

Resolver los conflictos de Git existentes preservando cambios compatibles y
verificar/corregir los requisitos de NetMO: arquitectura por capas, frontend
vanilla con configuración de API, CORS por `CORS_ORIGIN`, despliegue en Render y
Netlify/Pages, sin Docker ni Nginx y sin código/configuración obsoletos.
Eliminar credenciales activas de archivos de ejemplo y del seed.

No se reescribirá el historial de Git ni se publicarán cambios. El historial
contiene valores de credenciales ya expuestos; las credenciales correspondientes
deben rotarse fuera del repositorio antes de cualquier publicación.

## Estado actual observado

- `database/.env.example` contiene valores que no son placeholders.
- `database/seed.sql` tiene una variante que usa contraseñas fijas y otra que
  obtiene las contraseñas mediante `NETMO_SEED_*_PASSWORD`.
- Hay conflictos de Git en curso en archivos de aplicación, base de datos,
  documentación y especificaciones.
- No se encontró `.env` ni `database/.env`; no hay una configuración local
  disponible para conectar con Neon.
- `CONTEXT.md` y `documentacion-netmo.txt` no existen en la raíz; existe una
  copia de documentación bajo `reportes y cosas extra/`.
- El historial contiene credenciales previamente comprometidas.

## Comportamiento esperado

- Los archivos de ejemplo contienen únicamente placeholders no utilizables.
- Los seeds toman las contraseñas exclusivamente de variables de entorno y
  fallan explícitamente si falta una variable requerida.
- `.gitignore` excluye archivos `.env`, dependencias instaladas y dumps/backups,
  sin excluir ejemplos de entorno.
- Los conflictos se integran sin marcadores y sin perder configuración,
  documentación o cambios funcionales compatibles.
- El backend conserva Node.js/CommonJS, HTTP nativo y separación por capas; el
  frontend permanece vanilla y toma su URL de API desde `config.js`.
- CORS se restringe mediante `CORS_ORIGIN`; Render, Netlify/Pages y `DEPLOY.md`
  describen la misma configuración y flujo.
- No quedan archivos operativos Docker/Nginx si no son requeridos por el
  despliegue solicitado.
- No se modifican commits históricos ni se hace commit/push. Neon no se usa
  hasta que haya una conexión local válida y las credenciales expuestas se
  roten.

## Criterios de aceptación

1. No hay credenciales en los archivos de ejemplo ni contraseñas literales en
   el seed.
2. El seed conserva el requisito de variables de entorno y permanece idempotente.
3. No quedan marcadores de conflicto en los archivos integrados.
4. `.gitignore` excluye `.env`, `node_modules` y dumps/backups, preservando
   `.env.example`.
5. El backend arranca localmente; las pruebas/API verificables sin Neon pasan.
6. Se mantienen los artefactos de despliegue y la documentación pedida, sin
   Docker/Nginx.
7. El historial no se reescribe y no se publica ningún cambio.

## Riesgos y acciones externas

Las credenciales del historial deben rotarse, incluso si los valores actuales
se reemplazan. Retirar credenciales de commits existentes requeriría una
remediación coordinada del historial y del remoto; no forma parte de esta
ejecución. La base de Neon y el push permanecen bloqueados hasta esa rotación y
la revisión de un historial saneado.
