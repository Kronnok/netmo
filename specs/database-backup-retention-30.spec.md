# Especificación: retención de 30 backups diarios de PostgreSQL de NetMO

## Estado
Aprobada para implementación.

## Objetivo
Cambiar el sistema de backup automático de NetMO para conservar una copia lógica
completa por día hasta un máximo de 30 copias. Cuando exista una copia número
31, debe eliminarse la copia diaria más antigua y guardarse la nueva. Cada
archivo debe identificarse mediante la fecha en la que se creó.

## Comportamiento actual

- `database/scripts/backup-loop.sh` ejecuta `pg_dump --format=custom` cada
  `BACKUP_INTERVAL_SECONDS`, cuyo valor por defecto es 86400 segundos.
- El archivo válido siempre se llama `netmo-latest.dump`.
- Solo se admite un archivo `.dump` en `database/backups`.
- El archivo nuevo se valida con tamaño mayor que cero y `pg_restore --list`
  antes de reemplazar el anterior.
- Si falla la conexión o la validación, se conserva el backup anterior.

## Comportamiento esperado

- Cada ejecución exitosa debe crear un archivo `.dump` con el nombre
  `backup-YYYY-MM-DD.dump`, usando la fecha calendario de creación del backup.
- Deben conservarse como máximo 30 archivos `.dump` fechados.
- Si hay 30 archivos y se crea uno nuevo con una fecha que todavía no existe,
  debe eliminarse el archivo con la fecha más antigua después de validar el
  nuevo backup.
- Una ejecución fallida no debe eliminar ningún backup válido ni dejar el
  archivo temporal.
- El backup debe seguir siendo completo, compatible con PostgreSQL 16 y legible
  por `pg_restore --list`.
- El backup manual y el automático deben aplicar la misma política de nombres,
  validación y retención.
- El servicio debe seguir funcionando tras reinicios y no debe reconstruir ni
  modificar la base de producción.

## Decisiones aprobadas

1. **Formato de nombre:** `backup-YYYY-MM-DD.dump`, por ejemplo
   `backup-2026-09-16.dump`.
2. **Zona horaria:** usar `America/Argentina/Buenos_Aires` para determinar la
  fecha del nombre, de modo que el cambio de día siga el horario argentino.
  La configuración debe aplicarse tanto al servicio automático como a la
  ejecución manual.
3. **Una ejecución adicional el mismo día:** si ya existe
   `backup-YYYY-MM-DD.dump`, la ejecución debe validar y reemplazar ese archivo
   fechado de forma atómica, sin crear un archivo 31 ni eliminar otro día.
4. **Retención:** ordenar únicamente los archivos que cumplan exactamente el
  patrón `backup-YYYY-MM-DD.dump` dentro de la carpeta dedicada de backups
  (`database/backups` en el host y `/backups` en el contenedor); no eliminar
  archivos ajenos al patrón ni temporales de otras herramientas.
5. **Momento de limpieza:** validar y mover el backup nuevo primero; eliminar
   los archivos que excedan 30 después de la sustitución exitosa.
6. **Archivo anterior:** dejar de generar o exigir `netmo-latest.dump`. Los
   archivos anteriores con ese nombre, si aparecieran durante una migración,
   deben conservarse y reportarse o eliminarse mediante un procedimiento manual,
   no de forma silenciosa.

## Alcance

Incluye:

- `database/scripts/backup-loop.sh`.
- `database/docker-compose.yml` si hace falta declarar la zona horaria o una
  variable de retención configurable.
- `database/README.md` para actualizar ejecución, inspección y restauración.
- `specs/database-backups.spec.md` para reemplazar la política de una sola
  copia por la de 30 copias fechadas.
- `.env.example` si se documentan nuevas variables.
- Pruebas o comprobaciones reproducibles del nombre, reemplazo del mismo día,
  retención, fallos y limpieza de temporales.

Fuera de alcance:

- Cambios a la API, frontend o esquema de PostgreSQL.
- Backup físico, replicación o alta disponibilidad.
- Cifrado o subida a almacenamiento externo.
- Restauración automática sobre producción.
- Eliminación destructiva del volumen `postgres-data`.

## Reglas funcionales

- RF-01: el operador puede ejecutar un backup manual con un único comando
  documentado.
- RF-02: cada backup exitoso produce un archivo con fecha en formato
  `backup-YYYY-MM-DD.dump`.
- RF-03: nunca deben quedar más de 30 archivos que cumplan el patrón fechado.
- RF-04: al crear el backup del día 31, se elimina solo el backup fechado más
  antiguo, manteniendo los 30 más recientes.
- RF-05: repetir el backup en el mismo día reemplaza el archivo de ese día solo
  después de validar el nuevo dump.
- RF-06: un fallo de `pg_dump`, una salida vacía, una validación fallida o un
  destino no escribible devuelve código distinto de cero y conserva las copias
  válidas existentes.
- RF-07: los temporales se eliminan tanto después de una ejecución exitosa como
  después de un fallo o interrupción.
- RF-08: `pg_restore --list` debe leer cada archivo creado sin error.
- RF-09: el servicio automático continúa intentando cada
  `BACKUP_INTERVAL_SECONDS`; la retención no debe depender de reiniciar el
  contenedor.

## Requisitos no funcionales

- RNF-01: mantener `postgres:16-alpine` y `pg_dump --format=custom`.
- RNF-02: conservar `umask 077` y permisos restrictivos en los dumps.
- RNF-03: no incluir credenciales en nombres, logs, argumentos documentados ni
  archivos versionados.
- RNF-04: no borrar archivos que no coincidan exactamente con el patrón fechado.
- RNF-05: no interrumpir el servicio `postgres` ni el backend.

## Criterios de aceptación

- CA-01: una ejecución manual exitosa crea exactamente un archivo con el patrón
  `backup-YYYY-MM-DD.dump`, cuya fecha coincide con la fecha de creación según
  la zona horaria aprobada.
- CA-02: tras 30 ejecuciones exitosas correspondientes a 30 fechas, existen 30
  dumps fechados y todos pasan `pg_restore --list`.
- CA-03: una ejecución exitosa para una fecha nueva cuando ya hay 30 dumps
  conserva exactamente los 30 más recientes y elimina el más antiguo.
- CA-04: dos ejecuciones exitosas en la misma fecha dejan un solo archivo para
  ese día y el segundo reemplaza al primero únicamente después de validarse.
- CA-05: si PostgreSQL está detenido o las credenciales son inválidas, la
  ejecución falla, conserva todos los dumps válidos y no deja temporales.
- CA-06: un dump vacío o ilegible se rechaza sin borrar el backup fechado
  anterior ni otros días.
- CA-07: al reiniciar el servicio automático, la política de nombres y retención
  sigue funcionando sobre los dumps existentes.
- CA-08: la documentación permite localizar el backup del día, comprobar su
  tamaño e integridad y restaurarlo en una base temporal sin apuntar a
  producción.
- CA-09: ningún dump generado ni secreto queda versionado.

## Archivos y componentes afectados

- `database/scripts/backup-loop.sh`: nombre fechado, reemplazo del día,
  validación, retención y limpieza.
- `database/docker-compose.yml`: solo si se agrega configuración de zona horaria
  o retención.
- `database/README.md`: comandos, ejemplos de nombres, retención y restauración.
- `specs/database-backups.spec.md`: sincronizar la política aprobada.
- `database/.env.example`: solo si se agregan variables documentadas.

## Aprobación del alcance

- Se aprueban las decisiones 1, 2, 3, 5 y 6.
- Se aprueba la decisión 4 con una carpeta dedicada para los backups. La
  carpeta existente `database/backups`, montada como `/backups`, cumple ese
  propósito; no se agrega una subcarpeta adicional.
- Los archivos que no coincidan con `backup-YYYY-MM-DD.dump` no serán borrados
  automáticamente.

## Riesgos

- La fecha depende de la zona horaria argentina; una configuración distinta
  puede hacer que el nombre cambie cerca de medianoche.
- Dos procesos de backup simultáneos podrían competir por el archivo del día;
  debe definirse un mecanismo de bloqueo o una precondición de una sola instancia.
- Los 30 dumps contienen datos personales y siguen siendo una copia local en el
  mismo host que `postgres-data`; no protegen contra la pérdida del host.
- Los backups existentes `netmo-latest.dump` no tienen una fecha confiable en su
  nombre y no deben renombrarse automáticamente sin una decisión explícita.

## Plan posterior a la aprobación

1. Implementar las decisiones aprobadas, especialmente zona horaria,
  comportamiento de repetición diaria y migración de `netmo-latest.dump`.
2. Actualizar la especificación existente de backups para que no contradiga esta
   política.
3. Implementar el cambio únicamente en el script y documentación aprobados.
4. Ejecutar pruebas aisladas del script para éxito, fallo, mismo día, límite de
   30, limpieza y reinicio.
5. Validar Compose y, con PostgreSQL disponible, ejecutar un backup real y una
   restauración de prueba.
6. Cerrar esta especificación con evidencias y riesgos pendientes.

## Evidencias de validación

- `database/scripts/test-backup-loop.sh` implementa pruebas automatizadas con
  mocks para creación fechada, repetición del mismo día, retención 30→31,
  preservación de archivos ajenos y fallos de `pg_dump`, dumps vacíos y
  `pg_restore`.
- La suite fue ejecutada correctamente y mostró `Todas las pruebas de backup
  pasaron.`
- `sh -n database/scripts/backup-loop.sh` y `git diff --check` pasan.
- `docker compose config` pasa con `BACKUP_TIMEZONE=America/Argentina/Buenos_Aires`.
- La integración real contra PostgreSQL queda pendiente porque el contenedor
  existente presentó un timeout de red y no se dispone de una credencial que
  pueda exponerse o reutilizarse de forma segura.
