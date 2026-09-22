# Servicios Docker de NetMO

Este Compose aloja PostgreSQL y ejecuta la API Node.js en contenedores separados.
El backend se conecta a la base de datos usando el nombre interno del servicio,
`postgres`; desde el navegador, la API se alcanza por `http://localhost:3000`.

## Primer arranque

Desde este directorio:

```sh
cp .env.example .env
# Edita .env y define todas las contraseñas con valores privados.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

La imagen de PostgreSQL ejecuta automáticamente `schema.sql` y `seed.sql` la
primera vez que el volumen nombrado `postgres-data` está vacío. El backend espera a que
el healthcheck de PostgreSQL sea correcto antes de arrancar.

Las variables `NETMO_SEED_*_PASSWORD` solo se aplican durante la inicialización
de un volumen vacío. Si se cambian después, no modifican usuarios existentes:
usa un procedimiento de migración de contraseñas antes de eliminar o reconstruir
un volumen persistente.

El Compose base no publica PostgreSQL. Usa `docker-compose.dev.yml` solo para
diagnóstico local desde el host; el backend siempre usa el nombre interno
`postgres` y no necesita ese puerto publicado. Define `CORS_ORIGIN` con el
origen exacto del servidor que sirve `index.html`, o una lista separada por
comas.

El volumen nombrado `postgres-data` evita problemas de permisos del directorio
de datos en Docker Desktop para Windows. Si existe un directorio local
`database/postgres-data` de una instalación anterior, Compose no lo usa ni lo
borra: debe tratarse como una fuente de migración o respaldo separada.

Si `postgres-data` ya contiene una base, PostgreSQL omite esos scripts. Los
cambios posteriores de `schema.sql` no son migraciones automáticas. Antes de
reemplazar o eliminar un volumen existente, genera y valida un backup fechado
en `backups/backup-AAAA-MM-DD.dump`; la eliminacion del volumen es destructiva.

Verifica los servicios:

```sh
docker compose ps
curl http://localhost:3000/health
```

La respuesta esperada del healthcheck es `{"ok":true,"service":"netmo-api"}`.

## Usar la interfaz con la API

Desde este directorio, inicia un servidor estático para la interfaz:

```sh
python -m http.server 5500 --directory ..
```

Abre `http://localhost:5500/index.html`. La página usa por defecto la API de
Docker en `http://localhost:3000`, solicita el login y carga notebooks,
reservas, préstamos, tickets y preferencias desde PostgreSQL a través del
backend.

Para apuntar la página a otra API, define `window.NETMO_API_URL` antes del
script principal. El modo demo solo se activa explícitamente con
`window.NETMO_API_URL = null`.

## Detener y reiniciar

```sh
docker compose down
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Para borrar también los datos locales y permitir que el esquema y el seed se
ejecuten otra vez:

```sh
docker compose down -v
docker compose up -d --build
```

No ejecutes el último comando si necesitas conservar la información almacenada.
La opción `-v` elimina el volumen nombrado `postgres-data` y es destructiva.

## Backups diarios

El servicio `backup` usa la imagen `postgres:16-alpine` y ejecuta un backup
lógico una vez por día. Las copias se guardan en la carpeta dedicada
`database/backups`, con nombres como `backup-2026-09-16.dump`, usando el horario
`America/Argentina/Buenos_Aires` para determinar la fecha.

Se conservan como máximo 30 copias fechadas. Al crear una copia nueva cuando ya
hay 30, se elimina la más antigua después de validar y guardar correctamente la
nueva. Si se ejecuta otra copia el mismo día, reemplaza solo el archivo de esa
fecha. Los archivos que no sigan el patrón `backup-YYYY-MM-DD.dump` se conservan
y no participan de la limpieza automática. Si falla la conexión o la validación,
se conservan las copias existentes y el servicio reintenta al día siguiente.
Los archivos temporales usan otra extensión y se eliminan al terminar.

El servicio se inicia junto con el resto del Compose:

```sh
mkdir -p backups
docker compose up -d --build
docker compose logs -f backup
```

Para ejecutar una copia manual sin esperar al intervalo diario:

```sh
docker compose run --rm -e BACKUP_ONCE=1 backup
```

## Pruebas del sistema de backup

La suite local verifica el nombre fechado, el horario argentino, el reemplazo
del backup del mismo día, la retención de 30 copias, la preservación de archivos
ajenos al patrón y el manejo de errores de `pg_dump`, dumps vacíos y
`pg_restore`.

Desde la raíz del repositorio, ejecútala con:

```sh
chmod +x database/scripts/test-backup-loop.sh
database/scripts/test-backup-loop.sh
```

La suite usa mocks temporales y no modifica PostgreSQL ni necesita credenciales
reales. Para validar además la integración real, ejecuta el backup manual con
Compose y comprueba la copia creada:

```sh
docker compose run --rm -e BACKUP_ONCE=1 backup
find backups -maxdepth 1 -type f -name 'backup-*.dump' -printf '%f %s bytes\n'
```

Después valida una copia concreta con `pg_restore --list` dentro del contenedor:

```sh
docker compose run --rm --entrypoint pg_restore -v "$(pwd)/backups:/restore:ro" backup \
	--list /restore/backup-AAAA-MM-DD.dump
```

La copia local no debe considerarse una protección contra la pérdida del host.
Para producción, copia el backup fechado elegido de `database/backups` a un
almacenamiento externo y protege el archivo porque contiene datos de la aplicación.

## Restauración de prueba

No restaures sobre la base de producción. Crea una base temporal y usa una
instancia PostgreSQL compatible con la versión 16:

```sh
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" netmo_restore_test'
docker compose run --rm --entrypoint pg_restore -v "$(pwd)/backups:/restore:ro" backup \
	--clean --if-exists --no-owner \
	--host=postgres --port=5432 --username="$POSTGRES_USER" \
	--dbname=netmo_restore_test /restore/backup-AAAA-MM-DD.dump
```

Reemplaza `AAAA-MM-DD` por la fecha del archivo que quieras restaurar.

Después valida las tablas restauradas y levanta una API apuntando a
`netmo_restore_test`; `GET /health` debe responder correctamente y el login de
una cuenta seed debe funcionar. Elimina la base temporal cuando termines.