# Especificación: integración y endurecimiento de Docker para NetMO

## Estado

Aprobada para implementación a partir de la revisión del proyecto del 17 de
septiembre de 2026. La implementación debe realizarse en tareas pequeñas y
validarse contra los criterios de aceptación de este documento.

## Objetivo

Cerrar y documentar el entorno Docker de NetMO para desarrollo local y dejar
identificados los límites necesarios antes de utilizarlo en un servidor real.
La solución debe permitir levantar PostgreSQL, la API Node.js y el servicio de
backups de forma reproducible, validar su conectividad y recuperar datos sin
borrar accidentalmente la instancia persistente existente.

El alcance no cambia reglas de negocio, endpoints funcionales ni el modelo de
 datos salvo que una prueba de integración demuestre una incompatibilidad
específica del arranque.

## Hechos observados

- `database/docker-compose.yml` define los servicios `postgres`, `backend` y
  `backup`.
- PostgreSQL usa `postgres:16-alpine` y copia `schema.sql` y `seed.sql` al
  directorio de inicialización de la imagen.
- Los scripts de inicialización solo se ejecutan cuando el volumen de datos
  está vacío.
- El backend usa Node.js 22 Alpine, `pg` y el host interno `postgres`.
- El backend espera el healthcheck de PostgreSQL, pero no declara healthcheck
  propio.
- El servicio de backup genera archivos `backup-YYYY-MM-DD.dump`, valida cada
  dump con `pg_restore --list` y conserva hasta 30 archivos fechados.
- `database/.env`, `database/postgres-data/` y `database/backups/` están
  excluidos de Git.
- `docker compose --env-file .env.example config --quiet` valida actualmente la
  configuración.
- La suite aislada de backups cubre creación, reemplazo diario, retención,
  archivos ajenos al patrón y errores.
- La instancia persistente existente fue reportada como incompleta y no debe
  eliminarse sin un backup válido y una decisión explícita.
- Parte de la documentación todavía describe el antiguo archivo único
  `netmo-latest.dump` y debe alinearse con la política actual de 30 backups
  fechados.

## Problema actual

La configuración es suficiente para una prueba local, pero aún no está cerrada
como entorno integrado verificable. Existen riesgos de exposición de PostgreSQL,
configuración demasiado permisiva de CORS, ausencia de healthcheck de la API,
posible concurrencia de backups y falta de reproducibilidad completa en la
imagen Node.js.

Además, el estado de la base persistente existente no puede inferirse a partir
de los scripts actuales: PostgreSQL no vuelve a ejecutar `schema.sql` ni
`seed.sql` sobre un volumen ya inicializado.

## Alcance

Incluye:

1. Validación integrada de Compose, PostgreSQL, backend y backup.
2. Separación explícita entre configuración de desarrollo local y controles
   requeridos para un despliegue real.
3. Revisión de publicación del puerto PostgreSQL.
4. Healthcheck verificable para el backend y dependencias de arranque.
5. Validación del intervalo y ejecución única del servicio de backup.
6. Prevención de dos ejecuciones concurrentes del backup.
7. Construcción reproducible del backend mediante lockfile si el repositorio lo
   permite sin alterar dependencias funcionales.
8. Validación de arranque limpio, persistencia, backup y restauración temporal.
9. Alineación de README, specs y reportes con los nombres fechados actuales.
10. Procedimiento seguro para diagnosticar o reconstruir una base persistente
    incompleta.

Fuera de alcance:

- Kubernetes, alta disponibilidad, replicación o failover.
- Almacenamiento externo o cloud de backups.
- Cifrado de backups.
- Migraciones automáticas de `schema.sql` sobre bases existentes.
- Restauración automática sobre producción.
- Cambios de negocio en frontend, API o SQL no necesarios para el arranque.
- Eliminación automática de `postgres-data`.

## Decisiones aprobadas

### Perfil de desarrollo local

- Compose seguirá siendo la forma principal de levantar el entorno local.
- PostgreSQL podrá publicarse en el host solo para desarrollo y diagnóstico.
- La publicación deberá poder limitarse a `127.0.0.1` o deshabilitarse mediante
  configuración, sin cambiar el host interno que usa el backend.
- `docker compose down` no debe eliminar los datos persistentes.
- La eliminación o reconstrucción de `postgres-data` será una operación manual,
  documentada y precedida por un backup validado.

### Perfil de servidor real

- No se debe exponer PostgreSQL a Internet.
- `CORS_ORIGIN` debe configurarse con un origen concreto y no depender de `*`.
- Los backups deben copiarse fuera del host para cubrir la pérdida física del
  equipo.
- Las credenciales deben llegar mediante variables protegidas o un mecanismo de
  secretos del entorno, nunca desde archivos versionados.
- Esta especificación no convierte el Compose en una plataforma de alta
  disponibilidad.

### Backup

- Se mantiene `pg_dump --format=custom` desde un contenedor compatible con
  PostgreSQL 16.
- Se mantiene el patrón `backup-YYYY-MM-DD.dump` y la retención máxima de 30
  copias fechadas.
- Se rechaza un intervalo no numérico o menor que un mínimo operativo definido
  durante la implementación; `0` no debe provocar un bucle de backups sin pausa.
- Debe existir una protección contra ejecuciones concurrentes sobre el mismo
  directorio, preferentemente mediante un mecanismo de bloqueo compatible con
  Alpine y con la ejecución manual.
- Una ejecución fallida conserva el backup válido anterior y elimina sus
  temporales.

### Reproducibilidad

- Antes de modificar el Dockerfile, se comprobará si existe o puede generarse
  un `package-lock.json` coherente con `backend/package.json`.
- Si se incorpora el lockfile, la imagen usará instalación reproducible y se
  validará que la API conserve sus dependencias y arranque.
- No se actualizarán versiones de dependencias como parte de esta tarea salvo
  que una incompatibilidad de construcción lo exija y quede registrada.

## Comportamiento esperado

### Arranque limpio

- Compose debe validar su configuración sin secretos reales.
- Con un directorio de datos nuevo, PostgreSQL debe crear extensiones, tipos,
  tablas, funciones, triggers, vistas e información seed.
- El backend y el backup deben esperar a que PostgreSQL esté saludable.
- La API debe responder `/health` y permitir el login de una cuenta seed.

### Reinicio y persistencia

- Reiniciar o recrear servicios sin borrar el volumen nombrado `postgres-data` debe conservar los
  registros existentes.
- `schema.sql` y `seed.sql` no deben reinsertarse en cada reinicio.
- El backend debe seguir resolviendo PostgreSQL mediante el servicio `postgres`.

### Backup y restauración

- El backup manual y el automático deben aplicar la misma validación, nombre,
  zona horaria, retención y limpieza de temporales.
- Un backup válido debe poder inspeccionarse con `pg_restore --list`.
- La restauración de prueba debe usar una base temporal explícita y no debe
  apuntar a la base operativa por defecto.
- Después de restaurar, deben poder verificarse tablas funcionales, `/health` y
  el login seed.

### Estado persistente incompleto

- El procedimiento debe detectar la ausencia de tablas esperadas antes de
  proponer reconstruir la instancia.
- No se debe ejecutar `down -v`, borrar `postgres-data` ni recrear la base sin
  backup validado y confirmación manual.
- La documentación debe distinguir entre migrar una base existente y crear una
  instancia limpia; `schema.sql` no será tratado como sistema de migraciones.

## Archivos potencialmente afectados

- `database/docker-compose.yml`: publicación de puertos, healthchecks,
  dependencias y validaciones de entorno.
- `database/.env.example`: valores de ejemplo y separación de perfiles.
- `database/scripts/backup-loop.sh`: intervalo mínimo y bloqueo de concurrencia.
- `backend/Dockerfile`: instalación reproducible si se incorpora lockfile.
- `backend/package-lock.json`: solo si es necesario y coherente con las
  dependencias actuales.
- `database/README.md`: arranque, perfiles, persistencia, backups y
  restauración.
- `specs/database-container.spec.md`: sincronización de criterios y estado.
- `specs/database-backups.spec.md`: eliminación de referencias obsoletas al
  backup único.
- `reportes y cosas extra/documentacion-netmo.txt`: estado integrado real.
- `reportes y cosas extra/reporte-tests.txt`: evidencias ejecutadas.
- `.gitignore`: solo si una prueba demuestra que falta excluir algún artefacto.

No se modificará `database/schema.sql` ni `database/seed.sql` salvo que una
prueba de arranque limpio reproduzca una incompatibilidad concreta.

## Reglas de seguridad

- No versionar contraseñas, archivos `.env`, dumps ni directorios persistentes.
- No imprimir credenciales en logs, comandos documentados ni mensajes de error.
- No montar `postgres-data` dentro del servicio `backup`.
- Mantener permisos restrictivos sobre backups y archivos de configuración.
- No borrar backups válidos antes de validar el nuevo archivo.
- No restaurar con `--clean` sobre una base cuyo nombre no haya sido indicado de
  forma explícita.
- No usar la base persistente existente para pruebas destructivas.

## Criterios de aceptación

- CA-01: `docker compose --env-file .env.example config --quiet` pasa sin
  secretos reales.
- CA-02: un entorno limpio levanta PostgreSQL, backend y backup mediante Compose
  y PostgreSQL aparece saludable.
- CA-03: el backend responde `GET /health` con el payload esperado después de
  que PostgreSQL esté listo.
- CA-04: el login de una cuenta seed funciona contra la base levantada por
  Compose.
- CA-05: después de crear un registro de prueba, reiniciar servicios sin borrar
  `postgres-data` conserva el registro.
- CA-06: el backup manual crea un dump fechado no vacío y `pg_restore --list` lo
  valida.
- CA-07: una ejecución fallida de `pg_dump` o `pg_restore` conserva el backup
  válido anterior y no deja temporales.
- CA-08: dos ejecuciones concurrentes no corrompen ni reemplazan de forma
  insegura el backup del día.
- CA-09: el intervalo `0`, vacío o no numérico es rechazado o normalizado a una
  configuración segura y documentada.
- CA-10: una restauración en `netmo_restore_test` recupera al menos `users`,
  `user_preferences`, `notebooks`, `reservations`, `loans`, `returns` y
  `tickets`.
- CA-11: la API apuntando temporalmente a la base restaurada responde `/health`
  y permite el login seed.
- CA-12: la publicación de PostgreSQL queda limitada o deshabilitada según el
  perfil elegido y nunca se presenta como configuración de Internet.
- CA-13: ninguna prueba destructiva elimina la instancia persistente existente
  sin backup validado y confirmación manual.
- CA-14: README, specs y reportes ya no contradicen la política de backups
  fechados con retención de 30 copias.
- CA-15: ningún secreto, backup, volumen operativo o archivo temporal queda
  versionado.

## Plan técnico por tareas

1. Ejecutar validaciones estáticas y confirmar el estado de la instancia Docker
   existente sin modificar volúmenes.
2. Definir y aplicar la configuración de exposición de PostgreSQL y CORS para el
   perfil local, dejando documentado el perfil de servidor.
3. Añadir o ajustar el healthcheck del backend y verificar el orden de arranque.
4. Endurecer el intervalo y la concurrencia del backup; ejecutar la suite aislada
   existente y ampliar solo los casos necesarios.
5. Comprobar la reproducibilidad del backend y añadir lockfile únicamente si la
   dependencia actual lo permite.
6. Ejecutar un arranque limpio en un entorno temporal separado del volumen
   persistente existente.
7. Validar `/health`, login, persistencia, backup y restauración temporal.
8. Sincronizar README, specs y reportes con las evidencias reales.
9. Ejecutar validación final de sintaxis, Compose, backups, diferencias y
   artefactos no versionados.

Cada tarea debe producir una comprobación específica antes de iniciar la
siguiente.

## Riesgos y decisiones pendientes

- Debe confirmarse si el despliegue objetivo seguirá siendo exclusivamente local
  o incluirá un servidor de pruebas.
- Un directorio local `database/postgres-data` de una instalación anterior no se
  migra automáticamente al volumen nombrado; requiere un procedimiento explícito
  de restauración o migración.
- El estado incompleto de la instancia actual puede requerir restaurar desde un
  backup anterior o reconstruirla; no se puede decidir sin inspección y backup.
- El backend tiene un defecto funcional independiente en la cancelación de
  reservas (`reservationId` no definido). Debe corregirse en una spec funcional
  separada o registrarse como bloqueo de la validación completa, no mezclarse
  silenciosamente con el endurecimiento Docker.
- No se añadirá una migración automática hasta contar con una especificación
  separada para migraciones de PostgreSQL.

## Estrategia de validación

1. `docker compose config --quiet` con variables de ejemplo.
2. `node --check backend/server.js` y comprobaciones de shell disponibles.
3. Suite `database/scripts/test-backup-loop.sh`.
4. Arranque limpio usando un proyecto Compose o volumen temporal separado.
5. Comprobación de `docker compose ps` y logs sin secretos.
6. Pruebas de `/health`, login y tablas esperadas.
7. Registro de prueba, reinicio y comprobación de persistencia.
8. Backup manual, validación con `pg_restore --list` y prueba de retención.
9. Restauración en base temporal y comprobación funcional.
10. Revisión de `.gitignore`, `git diff --check` y ausencia de artefactos
    sensibles versionados.

## Cierre de la especificación

La especificación se considerará cerrada cuando todos los criterios de
aceptación aplicables tengan evidencia registrada en el reporte de tests, los
riesgos no resueltos estén documentados y la instancia persistente existente
haya sido tratada sin pérdida de datos.
