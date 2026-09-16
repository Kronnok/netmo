#!/bin/sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_DATABASE=${BACKUP_DATABASE:-${POSTGRES_DB:-netmo}}
BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
BACKUP_TIMEZONE=${BACKUP_TIMEZONE:-America/Argentina/Buenos_Aires}
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
  case "$(basename "$existing_dump")" in
    backup-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].dump)
      ;;
    *)
      echo "ADVERTENCIA: se conserva el archivo ajeno al patron de backups: $existing_dump" >&2
      ;;
  esac
done

backup_once() {
  backup_date=$(TZ="$BACKUP_TIMEZONE" date '+%Y-%m-%d')
  backup_file=${BACKUP_DIR}/backup-${backup_date}.dump
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
  mv -f "$temp_file" "$backup_file"
  trap - EXIT HUP INT TERM

  dated_backups=''
  for candidate in "$BACKUP_DIR"/backup-????-??-??.dump; do
    [ -f "$candidate" ] || continue
    case "$(basename "$candidate")" in
      backup-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].dump)
        dated_backups=$(printf '%s\n%s' "$dated_backups" "$(basename "$candidate")")
        ;;
    esac
  done

  if [ -n "$dated_backups" ]; then
    backup_count=$(printf '%s\n' "$dated_backups" | awk 'NF > 0 {count++} END {print count + 0}')
    backups_to_remove=$((backup_count - 30))
    printf '%s\n' "$dated_backups" | sort | awk -v limit="$backups_to_remove" 'NF > 0 && ++count <= limit {print}' |
      while IFS= read -r old_backup; do
        rm -f "$BACKUP_DIR/$old_backup"
        echo "Backup antiguo eliminado: ${BACKUP_DIR}/${old_backup}."
      done
  fi

  echo "Backup valido guardado en ${backup_file}."
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
