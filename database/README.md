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

La migración 010 renombra `users.legajo` a `users.dni` conservando los valores y
la restricción de unicidad; agrega ubicaciones opcionales a los carros. La 011
crea el catálogo de ubicaciones, agrega `loans.reminder_sent_at` y la tabla
`ticket_replies`. Las cuentas nuevas requieren un DNI numérico de 7 a 10
dígitos; no se modifican los DNI de cuentas ya existentes.

La migración 012 asigna IDs internos estables a carros y ubicaciones. Las
notebooks se relacionan con `carros.id` y los carros con `ubicaciones.id`;
`carros.numero` y `ubicaciones.slug` quedan como valores únicos editables.
La migración conserva las relaciones existentes al cambiar esas claves. La
restauración de backups JSON también convierte las referencias antiguas por
número/slug a las nuevas relaciones por ID.

El envío de recordatorios de devolución permanece deshabilitado hasta integrar
Gmail. `loans.reminder_sent_at` no se actualiza mientras ese envío no esté
disponible; la configuración de otros correos no se altera.

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
