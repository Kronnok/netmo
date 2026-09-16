# Especificación: backups de PostgreSQL de NetMO

## Estado
Implementada. Alcance revisado: backup logico completo diario de PostgreSQL
dentro de Docker, conservando hasta 30 archivos validos fechados según el
horario argentino. Pendiente de validacion con PostgreSQL levantado.

## Objetivo
Implementar un backup diario de la base PostgreSQL completa de NetMO. Cada
archivo debe contener los datos existentes en el momento de la ejecucion, no
solo el esquema ni una seleccion de tablas.

- PostgreSQL se ejecuta en el servicio `postgres` de `database/docker-compose.yml`.
- Cada backup debe generar o reemplazar `backup-YYYY-MM-DD.dump` con extension
  `.dump`, usando `America/Argentina/Buenos_Aires` para determinar la fecha.
- El directorio dedicado puede conservar como maximo 30 archivos que cumplan el
  patron `backup-YYYY-MM-DD.dump`.
- La retencion conserva las 30 fechas mas recientes; al superar ese limite se
  elimina la fecha mas antigua despues de validar el nuevo backup.
- Una ejecucion fallida debe mantener intacto el backup valido anterior.
- El esquema y `seed.sql` solo se ejecutan automaticamente cuando el volumen esta
  vacio; un backup nunca debe reconstruir ni sobrescribir la base de produccion.
- El Compose actual no declara aun el servicio `backup`; el README describe el
  comportamiento deseado, pero la configuracion versionada debe implementarlo.
- El volumen `postgres-data` es persistencia operativa, no una copia independiente:
  perder el host o borrar ese directorio también puede perder los datos.
- Ejecución manual y automatizable mediante un script versionado.
- Directorio de destino configurable y excluido de Git.
- Verificación de que el archivo generado no esté vacío y sea legible por la
  herramienta de restauración.
- Restauración documentada sobre una base de datos de destino y validación
  posterior mediante `/health` y consultas funcionales.

### Fuera de alcance inicial

- Backup físico continuo o replicación de PostgreSQL.
- Alta disponibilidad y recuperación automática ante desastre.
- Subida a almacenamiento cloud. Podrá añadirse en una especificación posterior
  sin cambiar el formato local del backup.
- Backup de archivos estáticos del frontend, imágenes Docker o secretos.

## Decisiones aprobadas

1. **Formato:** usar `pg_dump --format=custom` para permitir restauraciones
   selectivas con `pg_restore`.
2. **Contenido:** el dump sera completo y no excluira tablas, filas, secuencias,
  extensiones, funciones, triggers ni objetos grandes de la base respaldada.
  Las credenciales y roles del cluster no se guardan dentro del dump; se
  administran mediante las variables y el procedimiento de restauracion.
3. **Frecuencia:** una ejecucion automatica cada 86400 segundos, equivalente a
  un backup diario. Tambien existira una ejecucion manual para pruebas y
  recuperacion operativa.
4. **Retencion:** se conservan hasta 30 archivos `backup-YYYY-MM-DD.dump`; cada
  nuevo archivo temporal debe usar una extension que no sea `.dump`, reemplazar
  el archivo de su fecha solo despues de validarse y eliminar los excedentes
  despues de finalizar correctamente la sustitucion.
5. **Destino:** `database/backups`, configurable mediante `BACKUP_DIR`, montado
  en un volumen independiente de `postgres-data`.
6. **Proteccion:** los archivos contienen datos personales, deben tener permisos
  restrictivos y no deben versionarse. El cifrado en reposo o una copia externa
  quedan fuera de esta primera implementacion.
7. **Zona horaria:** la fecha del nombre usa `America/Argentina/Buenos_Aires`.
8. **Coordinacion:** el backup se ejecuta desde un contenedor compatible con
  PostgreSQL 16 y falla con un codigo distinto de cero si la base no responde.

## Requisitos funcionales

- RF-01: el operador debe poder ejecutar un backup con un único comando desde el
  directorio documentado.
- RF-02: el script debe leer host, puerto, base, usuario, contraseña, destino y
  frecuencia desde variables de entorno o el `.env` existente, sin escribir
  credenciales en el repositorio.
- RF-03: cada backup debe generar un archivo temporal que no termine en `.dump`
  y aprobarlo como `backup-YYYY-MM-DD.dump` con extension `.dump`.
- RF-03a: el dump debe incluir todos los esquemas, tablas, filas, secuencias,
  extensiones, funciones, triggers y objetos grandes respaldables de la base,
  sin filtrar las tablas funcionales de NetMO.
- RF-03b: la ejecucion automatica debe realizarse una vez por dia y el operador
  debe poder disparar una copia manual sin esperar el intervalo.
- RF-04: el script debe crear el directorio de destino si no existe y rechazar un
  destino no escribible.
- RF-05: una ejecución exitosa debe validar que el archivo existe, tiene tamaño
  mayor que cero y puede ser inspeccionado por `pg_restore --list`.
- RF-06: una ejecución fallida debe devolver un código de salida distinto de cero
  y no debe borrar el último backup válido.
- RF-07: el directorio configurado debe contener como maximo 30 archivos que
  cumplan `backup-YYYY-MM-DD.dump`; la limpieza nunca debe ejecutarse antes de
  validar el reemplazo nuevo y debe eliminar temporales ante exito o fallo.
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
  ejecute `pg_dump --format=custom` contra el servicio `postgres` sin opciones
  de exclusion de tablas o datos.
2. Añadir un servicio `backup` en `database/docker-compose.yml` y un volumen
  independiente `./backups:/backups`, sin mezclarlo con `postgres-data`.
3. Ejecutar el script desde un contenedor temporal de la imagen oficial de
   PostgreSQL o desde el contenedor `postgres`, evitando depender de `pg_dump` en
   la máquina host.
4. Incorporar variables documentadas como `BACKUP_DIR`,
  `BACKUP_INTERVAL_SECONDS=86400`, `BACKUP_DATABASE` y `BACKUP_ONCE`,
  manteniendo `POSTGRES_*` como fuente de conexion.
5. Documentar una restauración segura en una base temporal con
   `pg_restore --clean --if-exists`, validando tablas, usuarios y `/health` antes
   de considerar recuperado el servicio.
6. Mantener `database/backups/` y cualquier archivo generado fuera del control
   de versiones mediante `.gitignore`.

## Criterios de aceptación

- CA-01: con PostgreSQL levantado, el servicio o comando documentado ejecuta un
  backup diario completo, crea un `backup-YYYY-MM-DD.dump` valido y devuelve
  codigo 0.
- CA-02: `pg_restore --list` puede leer el archivo generado sin error.
- CA-02a: el listado del dump contiene las tablas y objetos funcionales de
  NetMO, incluyendo `users`, `notebooks`, `reservations`, `loans`, `tickets`,
  `returns`, `late_returns` y `user_preferences`.
- CA-03: si PostgreSQL está detenido o las credenciales son inválidas, el comando
  falla con código distinto de cero y conserva los backups existentes.
- CA-04: una restauración en una base temporal recupera el esquema y los datos de
  `users`, `notebooks`, `reservations`, `loans` y `tickets`.
- CA-05: tras restaurar en un entorno de prueba, `GET /health` responde con
  `{"ok":true,"service":"netmo-api"}` y el login de una cuenta seed funciona.
- CA-06: una prueba de ejecucion sucesiva confirma que existen como maximo 30
  archivos `.dump` fechados, que cada archivo contiene los datos completos de la
  base al momento de la copia y que un fallo conserva las copias anteriores sin
  dejar temporales.
- CA-07: ningún secreto, backup generado o dato de prueba queda versionado.

## Plan de implementación

1. Implementar el formato, frecuencia diaria, retencion, destino y proteccion
  aprobados en esta especificacion.
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