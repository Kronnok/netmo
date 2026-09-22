#!/bin/sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_DATABASE=${BACKUP_DATABASE:-${POSTGRES_DB:-netmo}}
BACKUP_INTERVAL_SECONDS=${BACKUP_INTERVAL_SECONDS:-86400}
BACKUP_TIMEZONE=${BACKUP_TIMEZONE:-America/Argentina/Buenos_Aires}
BACKUP_ONCE=${BACKUP_ONCE:-0}
BACKUP_CONNECTION_RETRIES=${BACKUP_CONNECTION_RETRIES:-15}
BACKUP_RETRY_DELAY_SECONDS=${BACKUP_RETRY_DELAY_SECONDS:-2}
BACKUP_LOCK_DIR=${BACKUP_LOCK_DIR:-${BACKUP_DIR}/.netmo-backup.lock}
BACKUP_LOCK_MAX_AGE_SECONDS=${BACKUP_LOCK_MAX_AGE_SECONDS:-7200}

: "${POSTGRES_USER:?POSTGRES_USER es obligatorio}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD es obligatorio}"

case "$BACKUP_INTERVAL_SECONDS" in
  ''|*[!0-9]*)
    echo "ERROR: BACKUP_INTERVAL_SECONDS debe ser un numero entero." >&2
    exit 1
    ;;
esac

if [ "$BACKUP_INTERVAL_SECONDS" -lt 60 ]; then
  echo "ERROR: BACKUP_INTERVAL_SECONDS debe ser como minimo 60 segundos." >&2
  exit 1
fi

case "$BACKUP_CONNECTION_RETRIES" in
  ''|*[!0-9]*)
    echo "ERROR: BACKUP_CONNECTION_RETRIES debe ser un numero entero." >&2
    exit 1
    ;;
esac

case "$BACKUP_RETRY_DELAY_SECONDS" in
  ''|*[!0-9]*)
    echo "ERROR: BACKUP_RETRY_DELAY_SECONDS debe ser un numero entero." >&2
    exit 1
    ;;
esac

if [ "$BACKUP_CONNECTION_RETRIES" -lt 1 ] || [ "$BACKUP_RETRY_DELAY_SECONDS" -lt 1 ]; then
  echo "ERROR: los reintentos y su demora deben ser mayores que cero." >&2
  exit 1
fi

case "$BACKUP_LOCK_MAX_AGE_SECONDS" in
  ''|*[!0-9]*)
    echo "ERROR: BACKUP_LOCK_MAX_AGE_SECONDS debe ser un numero entero." >&2
    exit 1
    ;;
esac

if [ "$BACKUP_LOCK_MAX_AGE_SECONDS" -lt 60 ]; then
  echo "ERROR: BACKUP_LOCK_MAX_AGE_SECONDS debe ser como minimo 60 segundos." >&2
  exit 1
fi

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
  if ! mkdir "$BACKUP_LOCK_DIR" 2>/dev/null; then
    lock_started=$(cat "$BACKUP_LOCK_DIR/started_at" 2>/dev/null || printf '0')
    current_time=$(date '+%s')
    case "$lock_started" in
      ''|*[!0-9]*) lock_started=0 ;;
    esac
    if [ "$lock_started" -gt 0 ] && [ $((current_time - lock_started)) -ge "$BACKUP_LOCK_MAX_AGE_SECONDS" ]; then
      rm -f "$BACKUP_LOCK_DIR/started_at"
      if ! rmdir "$BACKUP_LOCK_DIR" 2>/dev/null || ! mkdir "$BACKUP_LOCK_DIR" 2>/dev/null; then
        echo "ERROR: ya hay otro backup ejecutandose en ${BACKUP_DIR}." >&2
        return 1
      fi
      echo "ADVERTENCIA: se recupero un bloqueo de backup abandonado." >&2
    else
      echo "ERROR: ya hay otro backup ejecutandose en ${BACKUP_DIR}." >&2
      return 1
    fi
  fi

  date '+%s' > "$BACKUP_LOCK_DIR/started_at"

  temp_file=''
  cleanup_backup() {
    [ -z "$temp_file" ] || rm -f "$temp_file"
    rm -f "$BACKUP_LOCK_DIR/started_at"
    rmdir "$BACKUP_LOCK_DIR" 2>/dev/null || true
  }
  trap 'cleanup_backup' EXIT HUP INT TERM

  backup_date=$(TZ="$BACKUP_TIMEZONE" date '+%Y-%m-%d')
  backup_file=${BACKUP_DIR}/backup-${backup_date}.dump
  temp_file=$(mktemp "${BACKUP_DIR}/.netmo-backup.XXXXXX")

  echo "Iniciando backup de ${BACKUP_DATABASE}..."
  dump_succeeded=0
  retry=1
  while [ "$retry" -le "$BACKUP_CONNECTION_RETRIES" ]; do
    if PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
      --format=custom \
      --host="${POSTGRES_HOST:-postgres}" \
      --port="${POSTGRES_PORT:-5432}" \
      --username="$POSTGRES_USER" \
      --dbname="$BACKUP_DATABASE" \
      --file="$temp_file"; then
      dump_succeeded=1
      break
    fi
    rm -f "$temp_file"
    temp_file=$(mktemp "${BACKUP_DIR}/.netmo-backup.XXXXXX")
    if [ "$retry" -lt "$BACKUP_CONNECTION_RETRIES" ]; then
      echo "El servidor aun no acepta backups; reintento ${retry}/${BACKUP_CONNECTION_RETRIES} en ${BACKUP_RETRY_DELAY_SECONDS} segundos." >&2
      sleep "$BACKUP_RETRY_DELAY_SECONDS"
    fi
    retry=$((retry + 1))
  done

  if [ "$dump_succeeded" -ne 1 ]; then
    echo "ERROR: pg_dump no pudo completar el backup." >&2
    cleanup_backup
    trap - EXIT HUP INT TERM
    return 1
  fi

  if [ ! -s "$temp_file" ]; then
    echo "ERROR: pg_dump genero un archivo vacio." >&2
    cleanup_backup
    trap - EXIT HUP INT TERM
    return 1
  fi

  if ! pg_restore --list "$temp_file" >/dev/null; then
    echo "ERROR: pg_restore no pudo validar el backup." >&2
    cleanup_backup
    trap - EXIT HUP INT TERM
    return 1
  fi

  chmod 600 "$temp_file"
  mv -f "$temp_file" "$backup_file"
  cleanup_backup
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
