# Base de datos NetMO

NetMO usa PostgreSQL 16. Configurá `DATABASE_URL` con la cadena de Neon o una
instancia local; el backend activa SSL automáticamente para hosts remotos.

Desde la raíz del proyecto:

```sh
npm run db:migrate
npm run db:seed
```

`db:migrate` crea el esquema en una base vacía y registra las migraciones
aplicadas en `schema_migrations`. `db:seed` carga las cuentas de ejemplo una
sola vez y requiere las variables `NETMO_SEED_*_PASSWORD`; están listadas en
[`.env.example`](../.env.example).

Las migraciones posteriores agregan baneos con vencimiento, carros y la
asignación de notebooks a carros, además del horario de reservas de lunes a
viernes, 08:00–11:50 y 13:30–17:40 en `America/Argentina/Buenos_Aires`. La
migración de carros conserva las ubicaciones existentes y rellena `carro_id`
cuando la ubicación contiene un número de carro válido.

Antes de aplicar cambios en producción, guardá un backup. El script opcional
[`scripts/backup-loop.sh`](scripts/backup-loop.sh) usa `DATABASE_URL` y requiere
las herramientas PostgreSQL `pg_dump` y `pg_restore`. En Git Bash, desde la
raíz, puede ejecutarse una copia puntual así:

```sh
BACKUP_ONCE=1 BACKUP_DIR=database/backups sh database/scripts/backup-loop.sh
```

Para restaurar un dump custom en una base de destino, comprobá primero que
`DATABASE_URL` apunte a la base correcta. `--clean` reemplaza objetos existentes:

```sh
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" database/backups/backup-AAAA-MM-DD.dump
```

Probá las copias en una base separada antes de restaurar sobre producción.
