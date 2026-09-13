#!/bin/sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_DATABASE=${BACKUP_DATABASE:-${POSTGRES_DB:-netmo}}
BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
BACKUP_FILE=${BACKUP_DIR}/netmo-latest.dump
BACKUP_ONCE=${BACKUP_ONCE:-0}

: "${POSTGRES_USER:?POSTGRES_USER es obligatorio}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD es obligatorio}"

case "$BACKUP_INTERVAL_SECONDS" in
  ''|*[!0-9]*)
    echo "ERROR: BACKUP_INTERVAL_SECONDS debe ser un numero entero." >&2
    exit 1
    ;;
esac

umask 077
mkdir -p "$BACKUP_DIR"

for existing_dump in "$BACKUP_DIR"/*.dump; do
  [ -e "$existing_dump" ] || continue
  if [ "$existing_dump" != "$BACKUP_FILE" ]; then
    echo "ERROR: el directorio contiene otro backup .dump: $existing_dump" >&2
    exit 1
  fi
done

backup_once() {
  temp_file=$(mktemp "${BACKUP_DIR}/.netmo-backup.XXXXXX")
  cleanup_temp() { rm -f "$temp_file"; }
  trap 'cleanup_temp' EXIT HUP INT TERM

  echo "Iniciando backup de ${BACKUP_DATABASE}..."
  if ! PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    --format=custom \
    --host="${POSTGRES_HOST:-postgres}" \
    --port="${POSTGRES_PORT:-5432}" \
    --username="$POSTGRES_USER" \
    --dbname="$BACKUP_DATABASE" \
    --file="$temp_file"; then
    echo "ERROR: pg_dump no pudo completar el backup." >&2
    cleanup_temp
    return 1
  fi

  if [ ! -s "$temp_file" ]; then
    echo "ERROR: pg_dump genero un archivo vacio." >&2
    cleanup_temp
    return 1
  fi

  if ! pg_restore --list "$temp_file" >/dev/null; then
    echo "ERROR: pg_restore no pudo validar el backup." >&2
    cleanup_temp
    return 1
  fi

  chmod 600 "$temp_file"
  mv -f "$temp_file" "$BACKUP_FILE"
  trap - EXIT HUP INT TERM
  echo "Backup valido guardado en ${BACKUP_FILE}."
}

if [ "$BACKUP_ONCE" = "1" ]; then
  backup_once
  exit $?
fi

while :; do
  if ! backup_once; then
    echo "El backup fallo; se conserva el backup anterior. Se reintentara en ${BACKUP_INTERVAL_SECONDS} segundos." >&2
  fi
  sleep "$BACKUP_INTERVAL_SECONDS"
done
