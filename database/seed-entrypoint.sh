#!/bin/sh
set -eu

: "${NETMO_SEED_STUDENT_PASSWORD:?Definí NETMO_SEED_STUDENT_PASSWORD antes de inicializar la base}"
: "${NETMO_SEED_TEACHER_PASSWORD:?Definí NETMO_SEED_TEACHER_PASSWORD antes de inicializar la base}"
: "${NETMO_SEED_NETWORK_TEACHER_PASSWORD:?Definí NETMO_SEED_NETWORK_TEACHER_PASSWORD antes de inicializar la base}"
: "${NETMO_SEED_ADMIN_PASSWORD:?Definí NETMO_SEED_ADMIN_PASSWORD antes de inicializar la base}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  -v student_password="$NETMO_SEED_STUDENT_PASSWORD" \
  -v teacher_password="$NETMO_SEED_TEACHER_PASSWORD" \
  -v network_teacher_password="$NETMO_SEED_NETWORK_TEACHER_PASSWORD" \
  -v admin_password="$NETMO_SEED_ADMIN_PASSWORD" \
  -f /usr/local/share/netmo/seed.sql
