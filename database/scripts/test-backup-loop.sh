#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BACKUP_SCRIPT=${SCRIPT_DIR}/backup-loop.sh
TEST_ROOT=$(mktemp -d)
MOCK_BIN=${TEST_ROOT}/bin
BACKUP_DIR=${TEST_ROOT}/backups

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$MOCK_BIN" "$BACKUP_DIR"

cat > "$MOCK_BIN/pg_dump" <<'MOCK_DUMP'
#!/bin/sh
if [ "${MOCK_PG_DUMP_MODE:-success}" = "fail" ]; then
  exit 1
fi
output=''
for argument in "$@"; do
  case "$argument" in
    --file=*) output=${argument#--file=} ;;
  esac
done
if [ "${MOCK_PG_DUMP_MODE:-success}" = "empty" ]; then
  : > "$output"
else
  printf '%s\n' "${MOCK_DUMP_CONTENT:-test-dump}" > "$output"
fi
MOCK_DUMP

cat > "$MOCK_BIN/pg_restore" <<'MOCK_RESTORE'
#!/bin/sh
if [ "${MOCK_PG_RESTORE_MODE:-success}" = "fail" ]; then
  exit 1
fi
exit 0
MOCK_RESTORE
chmod +x "$MOCK_BIN/pg_dump" "$MOCK_BIN/pg_restore"

run_backup() {
  BACKUP_DIR="$BACKUP_DIR" \
  BACKUP_ONCE=1 \
  BACKUP_TIMEZONE=America/Argentina/Buenos_Aires \
  POSTGRES_USER=test \
  POSTGRES_PASSWORD=test \
  MOCK_PG_DUMP_MODE=${MOCK_PG_DUMP_MODE:-success} \
  MOCK_PG_RESTORE_MODE=${MOCK_PG_RESTORE_MODE:-success} \
  MOCK_DUMP_CONTENT=${MOCK_DUMP_CONTENT:-test-dump} \
  PATH="$MOCK_BIN:$PATH" \
  "$BACKUP_SCRIPT" >/dev/null 2>&1
}

assert_file() {
  test -f "$1" || {
    echo "FALLO: falta el archivo $1" >&2
    exit 1
  }
}

assert_not_file() {
  test ! -e "$1" || {
    echo "FALLO: existe el archivo $1" >&2
    exit 1
  }
}

current_date=$(TZ=America/Argentina/Buenos_Aires date '+%Y-%m-%d')
current_backup=${BACKUP_DIR}/backup-${current_date}.dump

run_backup
assert_file "$current_backup"
test "$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'backup-????-??-??.dump' | wc -l)" -eq 1

test -f "$BACKUP_DIR/backup-${current_date}.dump"
first_content=$(cat "$current_backup")
MOCK_DUMP_CONTENT=second-run run_backup
test "$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'backup-????-??-??.dump' | wc -l)" -eq 1
test "$(cat "$current_backup")" = second-run
test "$first_content" != "$(cat "$current_backup")"

rm -f "$BACKUP_DIR"/*.dump
printf '%s\n' preserved > "$BACKUP_DIR/notes.txt"
for day in $(seq -w 1 30); do
  : > "$BACKUP_DIR/backup-2020-01-${day}.dump"
done
run_backup
test "$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'backup-????-??-??.dump' | wc -l)" -eq 30
assert_not_file "$BACKUP_DIR/backup-2020-01-01.dump"
assert_file "$BACKUP_DIR/backup-2020-01-02.dump"
assert_file "$BACKUP_DIR/notes.txt"

printf '%s\n' previous > "$current_backup"
MOCK_PG_DUMP_MODE=fail
if run_backup; then
  echo 'FALLO: pg_dump fallido devolvio codigo 0' >&2
  exit 1
fi
test "$(cat "$current_backup")" = previous

test -z "$(find "$BACKUP_DIR" -maxdepth 1 -name '.netmo-backup.*' -print -quit)"
MOCK_PG_DUMP_MODE=empty
if run_backup; then
  echo 'FALLO: dump vacio devolvio codigo 0' >&2
  exit 1
fi
test "$(cat "$current_backup")" = previous

MOCK_PG_DUMP_MODE=success
MOCK_PG_RESTORE_MODE=fail
if run_backup; then
  echo 'FALLO: pg_restore fallido devolvio codigo 0' >&2
  exit 1
fi
test "$(cat "$current_backup")" = previous
test -z "$(find "$BACKUP_DIR" -maxdepth 1 -name '.netmo-backup.*' -print -quit)"

echo 'Todas las pruebas de backup pasaron.'
