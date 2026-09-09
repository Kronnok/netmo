# Especificación: backups de PostgreSQL de NetMO

## Estado
 Aprobada para implementación: backup diario dentro de Docker, conservando un
 único archivo válido que reemplaza al anterior después de la validación.
sistema de backups.

## Objetivo
 RF-03: cada backup debe generar o reemplazar `netmo-latest.dump` con extensión
 `.dump`.
- PostgreSQL se ejecuta en el servicio `postgres` de `database/docker-compose.yml`.
 RF-07: la política de retención debe conservar exactamente un backup válido;
 una ejecución fallida debe mantener el archivo anterior.
  `database/seed.sql` solo cuando el volumen está vacío.
- No existen scripts de `pg_dump` o `pg_restore`, tareas programadas, política de
  retención, cifrado ni procedimiento probado de restauración.
- El volumen `postgres-data` es persistencia operativa, no una copia independiente:
  perder el host o borrar ese directorio también puede perder los datos.
 2. Añadir un volumen independiente para backups, por ejemplo
   `./backups:/backups`, sin mezclarlo con `postgres-data`.
 3. Ejecutar el script desde un servicio Docker basado en la imagen oficial de
   PostgreSQL, evitando depender de `pg_dump` en la máquina host.
 4. Incorporar variables documentadas como `BACKUP_DIR`, `BACKUP_INTERVAL_SECONDS`
   y `BACKUP_DATABASE`, manteniendo `POSTGRES_*` como fuente de conexión.
- Ejecución manual y automatizable mediante un script versionado.
- Directorio de destino configurable y excluido de Git.
- Nombres de archivo con fecha y hora en UTC.
- Verificación de que el archivo generado no esté vacío y sea legible por la
  herramienta de restauración.
- Restauración documentada sobre una base de datos de destino y validación
  posterior mediante `/health` y consultas funcionales.
- Política inicial de retención configurable, con un valor por defecto explícito.

### Fuera de alcance inicial

- Backup físico continuo o replicación de PostgreSQL.
- Alta disponibilidad y recuperación automática ante desastre.
- Subida a almacenamiento cloud. Podrá añadirse en una especificación posterior
  sin cambiar el formato local del backup.
- Backup de archivos estáticos del frontend, imágenes Docker o secretos.

## Decisiones pendientes de aprobación

1. **Formato:** usar `pg_dump --format=custom` para permitir restauraciones
   selectivas con `pg_restore`.
2. **Frecuencia:** definir si se ejecutará diariamente, al menos una vez por día,
   o solo manualmente durante esta primera etapa.
3. **Retención:** definir cuántas copias conservar. Propuesta inicial: 7 copias
   diarias y eliminación automática de las más antiguas.
4. **Destino:** propuesta inicial `database/backups`, configurable mediante
   `BACKUP_DIR`, y posteriormente un almacenamiento externo para tolerar la
   pérdida del host.
5. **Protección:** los archivos pueden contener datos personales y deben tener
   permisos restrictivos. El cifrado en reposo y fuera del host debe aprobarse
   antes de usar backups en producción.
6. **Coordinación:** el backup lógico debe ejecutarse contra una base de datos
   disponible y reportar un error no silencioso si PostgreSQL no responde.

## Requisitos funcionales

- RF-01: el operador debe poder ejecutar un backup con un único comando desde el
  directorio documentado.
- RF-02: el script debe leer host, puerto, base, usuario, contraseña, destino y
  frecuencia desde variables de entorno o el `.env` existente, sin escribir
  credenciales en el repositorio.
- RF-03: cada backup debe generar un archivo único con fecha/hora UTC y extensión
  `.dump`.
- RF-04: el script debe crear el directorio de destino si no existe y rechazar un
  destino no escribible.
- RF-05: una ejecución exitosa debe validar que el archivo existe, tiene tamaño
  mayor que cero y puede ser inspeccionado por `pg_restore --list`.
- RF-06: una ejecución fallida debe devolver un código de salida distinto de cero
  y no debe borrar el último backup válido.
- RF-07: la limpieza por retención no debe eliminar backups recientes ni superar
  el número configurado de copias conservadas.
- RF-08: debe existir un procedimiento de restauración en un entorno de prueba
  que no sobrescriba producción accidentalmente.
- RF-09: la documentación debe indicar cómo comprobar fecha, tamaño, integridad,
  restauración y resultado del healthcheck.

## Requisitos no funcionales

- RNF-01: el mecanismo debe funcionar con el PostgreSQL definido en el Dockerfile
  actual (`postgres:16-alpine`).
- RNF-02: el backup no debe depender de herramientas instaladas en el host si
  puede ejecutarse desde un contenedor compatible.
- RNF-03: las credenciales no deben aparecer en argumentos visibles del proceso,
  logs, nombres de archivo ni documentación de ejemplo.
- RNF-04: los archivos de backup y sus directorios deben tener permisos mínimos
  razonables para el usuario que ejecuta el proceso.
- RNF-05: el proceso debe ser idempotente respecto de ejecuciones sucesivas y no
  debe detener el servicio de la API.

## Diseño propuesto

1. Añadir un script versionado, por ejemplo `database/scripts/backup.sh`, que
   ejecute `pg_dump --format=custom` contra el servicio `postgres`.
2. Añadir un volumen independiente para backups, por ejemplo
   `./backups:/backups`, sin mezclarlo con `postgres-data`.
3. Ejecutar el script desde un contenedor temporal de la imagen oficial de
   PostgreSQL o desde el contenedor `postgres`, evitando depender de `pg_dump` en
   la máquina host.
4. Incorporar variables documentadas como `BACKUP_DIR`, `BACKUP_RETENTION` y
   `BACKUP_DATABASE`, manteniendo `POSTGRES_*` como fuente de conexión.
5. Documentar una restauración segura en una base temporal con
   `pg_restore --clean --if-exists`, validando tablas, usuarios y `/health` antes
   de considerar recuperado el servicio.
6. Mantener `database/backups/` y cualquier archivo generado fuera del control
   de versiones mediante `.gitignore`.

## Criterios de aceptación

- CA-01: con PostgreSQL levantado, el comando documentado crea exactamente un
  backup `.dump` válido y devuelve código 0.
- CA-02: `pg_restore --list` puede leer el archivo generado sin error.
- CA-03: si PostgreSQL está detenido o las credenciales son inválidas, el comando
  falla con código distinto de cero y conserva los backups existentes.
- CA-04: una restauración en una base temporal recupera el esquema y los datos de
  `users`, `notebooks`, `reservations`, `loans` y `tickets`.
- CA-05: tras restaurar en un entorno de prueba, `GET /health` responde con
  `{"ok":true,"service":"netmo-api"}` y el login de una cuenta seed funciona.
- CA-06: una prueba de ejecución sucesiva confirma que solo existe
  `netmo-latest.dump` y que un fallo conserva la copia anterior.
- CA-07: ningún secreto, backup generado o dato de prueba queda versionado.

## Plan de implementación

1. Aprobar formato, frecuencia, retención, destino y política de cifrado.
2. Crear el script de backup y su manejo de errores.
3. Añadir el volumen/configuración Docker y las variables de entorno de ejemplo.
4. Implementar el reemplazo atómico y la validación con `pg_restore --list`.
5. Documentar ejecución manual, automatización y restauración segura.
6. Probar backup, fallo de conexión, retención y restauración en una base temporal.

## Riesgos

- Un backup almacenado en el mismo host que `postgres-data` no protege contra la
  pérdida física o corrupción del host; para producción debe existir una copia
  externa.
- Los dumps contienen información personal y deben tratarse como datos sensibles.
- Restaurar con `--clean` sobre una base equivocada puede destruir información;
  el procedimiento debe exigir una base de destino explícita y no usar producción
  como destino por defecto.