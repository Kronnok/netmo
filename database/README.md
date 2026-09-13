# Servicios Docker de NetMO

Este Compose aloja PostgreSQL y ejecuta la API Node.js en contenedores separados.
El backend se conecta a la base de datos usando el nombre interno del servicio,
`postgres`; desde el navegador, la API se alcanza por `http://localhost:3000`.

## Primer arranque

Desde este directorio:

```sh
cp .env.example .env
# Edita .env y define POSTGRES_PASSWORD con un valor privado.
docker compose up -d --build
```

La imagen de PostgreSQL ejecuta automáticamente `schema.sql` y `seed.sql` la
primera vez que el volumen `postgres-data` está vacío. El backend espera a que
el healthcheck de PostgreSQL sea correcto antes de arrancar.

Si `postgres-data` ya contiene una base, PostgreSQL omite esos scripts. Los
cambios posteriores de `schema.sql` no son migraciones automáticas. Antes de
reemplazar o eliminar un volumen existente, genera y valida un backup completo
en `backups/netmo-latest.dump`; la eliminacion del volumen es destructiva.

Verifica los servicios:

```sh
docker compose ps
curl http://localhost:3000/health
```

La respuesta esperada del healthcheck es `{"ok":true,"service":"netmo-api"}`.

## Usar la interfaz con la API

Abre `index.html` con un servidor estático y define antes de cargarlo:

```html
<script>window.NETMO_API_URL = 'http://localhost:3000';</script>
```

Sin esa variable, la interfaz continúa funcionando en modo demo y no consulta
PostgreSQL.

## Detener y reiniciar

```sh
docker compose down
docker compose up -d
```

Para borrar también los datos locales y permitir que el esquema y el seed se
ejecuten otra vez:

```sh
docker compose down
rm -rf postgres-data
docker compose up -d --build
```

No ejecutes el último comando si necesitas conservar la información almacenada.

## Backups diarios

El servicio `backup` usa la imagen `postgres:16-alpine` y ejecuta un backup
lógico una vez por día. El archivo se guarda en `database/backups/netmo-latest.dump`.
Cada ejecución valida el archivo con `pg_restore --list` y solo después reemplaza
el backup anterior. Si falla la conexión o la validación, se conserva la copia
anterior y el servicio reintenta al día siguiente. En `database/backups` solo
puede existir un archivo `.dump`: `netmo-latest.dump`; los archivos temporales
usan otra extensión y se eliminan al terminar.

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

La copia local no debe considerarse una protección contra la pérdida del host.
Para producción, copia `database/backups/netmo-latest.dump` a un almacenamiento
externo y protege el archivo porque contiene datos de la aplicación.

## Restauración de prueba

No restaures sobre la base de producción. Crea una base temporal y usa una
instancia PostgreSQL compatible con la versión 16:

```sh
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" netmo_restore_test'
docker compose run --rm -v "$(pwd)/backups:/restore:ro" backup \
	sh -c 'pg_restore --clean --if-exists --no-owner \
	--host=postgres --port=5432 --username="$POSTGRES_USER" \
	--dbname=netmo_restore_test /restore/netmo-latest.dump'
```

Después valida las tablas restauradas y levanta una API apuntando a
`netmo_restore_test`; `GET /health` debe responder correctamente y el login de
una cuenta seed debe funcionar. Elimina la base temporal cuando termines.