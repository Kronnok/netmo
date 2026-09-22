FROM postgres:16-alpine
COPY schema.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY seed.sql /usr/local/share/netmo/seed.sql
COPY seed-entrypoint.sh /docker-entrypoint-initdb.d/02-seed.sh
