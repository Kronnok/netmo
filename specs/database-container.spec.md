# Especificacion: contenedor PostgreSQL persistente de NetMO

## Estado
Implementada. La decision de publicar PostgreSQL en el puerto host configurable
con `5432` por defecto fue aprobada. Pendiente de validacion con Docker y
PostgreSQL levantados.

## Objetivo
Definir y dejar reproducible el contenedor Docker que aloja la base de datos PostgreSQL de NetMO, conserva los datos entre reinicios, inicializa el esquema de forma controlada, expone solo los servicios necesarios y permite que el backend y el servicio de backup se conecten por la red interna de Docker.

## Hechos observados

- PostgreSQL se construye desde `database/Dockerfile` usando `postgres:16-alpine`.
- El Dockerfile copia `schema.sql` y `seed.sql` al directorio de inicializacion de PostgreSQL.
- `database/docker-compose.yml` ya define los servicios `postgres`, `backend` y `backup`.
- El volumen `./postgres-data:/var/lib/postgresql/data` conserva los datos fuera del contenedor.
- PostgreSQL ejecuta `schema.sql` y `seed.sql` solo cuando el directorio de datos esta vacio.
- El backend se conecta usando el host interno `postgres` y espera el healthcheck del servicio.
- El servicio `backup` usa PostgreSQL 16, espera a que `postgres` este saludable y guarda el backup en `./backups`.
- Las credenciales se entregan mediante variables de entorno y no deben escribirse en el repositorio.
- La base contiene usuarios, preferencias, notebooks, reservas, prestamos, devoluciones, tickets y funciones/vistas de soporte.

## Alcance

Incluye:

1. Imagen Docker de PostgreSQL compatible con el esquema actual.
2. Persistencia de datos mediante un volumen independiente del contenedor.
3. Inicializacion unica de esquema y datos seed sobre un volumen nuevo.
4. Healthcheck y orden de arranque del backend y backup.
5. Configuracion mediante `.env` sin secretos versionados.
6. Red interna para que backend y backup usen `postgres` como host.
7. Integracion con el backup diario completo definido en `database-backups.spec.md`.
8. Procedimientos de arranque, parada, reinicio, recuperacion y destruccion explicita de datos.

Fuera de alcance:

- Cambios al modelo de datos o a las reglas SQL del negocio.
- Alta disponibilidad, replicacion o failover.
- Almacenamiento cloud del backup.
- Exposicion publica de PostgreSQL fuera del entorno local de desarrollo.
- Restauracion automatica sobre la base de produccion.

## Decisiones aprobadas

1. **Version:** PostgreSQL 16 sobre `postgres:16-alpine`, alineado con el Dockerfile actual.
2. **Persistencia:** usar `./postgres-data:/var/lib/postgresql/data` como volumen operativo independiente del contenedor.
3. **Inicializacion:** ejecutar `schema.sql` y `seed.sql` automaticamente solo en un volumen vacio; nunca ejecutar seed en cada reinicio.
4. **Red:** backend y backup se conectan a `postgres:5432` dentro de la red de Compose.
5. **Puerto host:** publicar PostgreSQL en `${POSTGRES_PORT:-5432}`. Esta opcion queda aprobada para desarrollo y diagnostico local; en despliegues donde no se requiera acceso desde el host, debe poder deshabilitarse sin cambiar el backend.
6. **Credenciales:** exigir `POSTGRES_PASSWORD`; permitir configurar `POSTGRES_DB`, `POSTGRES_USER` y puertos mediante `.env` o variables del entorno.
7. **Healthcheck:** usar `pg_isready` con la base y usuario configurados, con reintentos antes de iniciar backend y backup.
8. **Backup:** mantener el servicio diario separado del volumen operativo. El backup completo y el requisito de unico `.dump` se rigen por `database-backups.spec.md`.
9. **Destruccion:** `docker compose down` no debe borrar datos; eliminar `postgres-data` debe documentarse como una operacion destructiva que exige confirmacion manual.

## Comportamiento esperado

### Arranque inicial

- Si `POSTGRES_PASSWORD` no esta definida, Compose debe rechazar la configuracion antes de iniciar servicios.
- Con un directorio `postgres-data` vacio, PostgreSQL debe crear la base configurada, extensiones, tipos, tablas, indices, triggers, vistas y datos seed.
- Backend y backup deben esperar a que PostgreSQL responda al healthcheck.
- La API debe poder autenticarse y consultar la base una vez que el servicio este saludable.

### Reinicio

- Reiniciar o recrear el contenedor sin eliminar `postgres-data` debe conservar usuarios, preferencias, reservas, prestamos, tickets y demas registros.
- `schema.sql` y `seed.sql` no deben volver a insertar datos sobre un volumen ya inicializado.
- El backend debe reconectar usando el nombre de servicio `postgres`.

### Backup y restauracion

- El backup debe ejecutarse diariamente desde su propio servicio y no debe compartir el volumen de datos de PostgreSQL.
- La restauracion debe hacerse primero sobre una base temporal compatible, nunca sobre produccion por defecto.
- Una restauracion valida debe recuperar el esquema y los datos funcionales necesarios para que la API y el login funcionen.

### Parada y destruccion

- `docker compose down` debe detener servicios sin borrar el volumen operativo.
- La eliminacion de `postgres-data` debe ser un paso separado y explicitamente destructivo.
- La documentacion debe advertir que el volumen y el backup local en el mismo host no protegen contra la perdida del host.

## Configuracion y archivos afectados

- `database/Dockerfile`
  - imagen base y scripts de inicializacion.
- `database/docker-compose.yml`
  - servicios, red, volumen, healthcheck, dependencias y variables.
- `database/.env.example`
  - nombres de variables y valores no sensibles de ejemplo.
- `database/schema.sql`
  - solo se modifica si una prueba demuestra una incompatibilidad del contenedor; no se prevén cambios de negocio.
- `database/seed.sql`
  - solo se modifica si los datos iniciales no permiten validar el arranque; no debe ejecutarse en cada reinicio.
- `database/scripts/backup-loop.sh`
  - integracion con la base saludable y el volumen independiente de backups.
- `database/README.md`
  - instrucciones de arranque, persistencia, backup, restauracion y destruccion.
- `database-backups.spec.md`
  - especificacion relacionada para el backup diario completo.

## Reglas de seguridad

- No incluir contraseñas reales en `.env.example`, Dockerfiles, Compose versionado, logs ni comandos documentados.
- No publicar el puerto PostgreSQL fuera de lo necesario para desarrollo.
- No montar `postgres-data` dentro del servicio de backup.
- Mantener permisos restrictivos sobre `postgres-data`, `backups` y el archivo `.env`.
- No ejecutar comandos destructivos de volumen como parte del arranque normal.
- No usar `seed.sql` como mecanismo de migracion sobre una base existente.

## Errores esperados

- Falta de `POSTGRES_PASSWORD`: Compose falla antes de iniciar.
- Directorio de datos no escribible: PostgreSQL no inicia y el error queda visible en logs.
- Healthcheck fallido: backend y backup permanecen esperando y no deben intentar operar contra una base no saludable.
- Esquema invalido: el primer arranque falla y debe requerir correccion antes de reutilizar el volumen.
- Conexion API fallida: el backend informa el error sin crear una base alternativa en memoria.
- Restauracion sobre destino no explicito: el procedimiento debe rechazar o requerir una confirmacion clara.

## Criterios de aceptacion

- CA-01: `docker compose config` valida la configuracion usando un `.env` de ejemplo sin secretos reales.
- CA-02: con `POSTGRES_PASSWORD` definida, `docker compose up -d --build` inicia PostgreSQL, backend y backup en el orden correcto.
- CA-03: `docker compose ps` muestra PostgreSQL saludable y backend/backup ejecutando sus procesos esperados.
- CA-04: un volumen vacio crea las extensiones, tablas, vistas, funciones, triggers y datos seed definidos por el esquema.
- CA-05: despues de crear un registro de prueba, reiniciar PostgreSQL y backend sin eliminar `postgres-data` conserva ese registro.
- CA-06: el backend resuelve `postgres` por la red interna y puede responder `/health` y autenticar una cuenta seed.
- CA-07: el backup diario se conecta solo despues del healthcheck, genera el dump completo y mantiene el unico `netmo-latest.dump` definido en la especificacion de backups.
- CA-08: `docker compose down` no elimina `postgres-data`; la eliminacion del directorio solo ocurre mediante una accion manual documentada.
- CA-09: una restauracion de prueba en una base temporal recupera datos de `users`, `user_preferences`, `notebooks`, `reservations`, `loans`, `returns` y `tickets`.
- CA-10: con una variable obligatoria ausente o una configuracion invalida, el arranque falla de forma visible y no crea una base parcial silenciosa.
- CA-11: ningun secreto, volumen operativo ni backup generado queda versionado.

## Estrategia de validacion

1. Ejecutar `docker compose config` con un `.env` de prueba y revisar servicios, volumenes, dependencias y variables sin mostrar secretos reales.
2. Levantar el Compose con una contraseña de prueba proporcionada fuera del repositorio.
3. Verificar healthcheck, logs y `/health` del backend.
4. Consultar tablas y datos seed dentro de PostgreSQL.
5. Crear un registro de prueba, reiniciar servicios y comprobar persistencia.
6. Ejecutar el backup manual y validar `pg_restore --list` y la regla de un unico `.dump`.
7. Restaurar en una base temporal y comprobar tablas, datos y login.
8. Probar que `docker compose down` conserva los datos y que la destruccion requiere un comando separado.
9. Ejecutar `git diff --check` y revisar que no existan secretos versionados.

## Riesgos y pendientes

- Un bind mount local depende de permisos y del sistema de archivos del host.
- El volumen operativo y el backup local no protegen contra la perdida del host; se requiere copiar el backup fuera del host para un entorno real.
- El seed actual contiene credenciales demo y solo debe usarse en desarrollo o pruebas controladas.
- Debe confirmarse si el entorno objetivo es exclusivamente desarrollo local o tambien un servidor de pruebas.

## Plan de validacion pendiente

1. Confirmar puerto host, destino del despliegue y politica de credenciales.
2. Validar y ajustar Dockerfile, Compose y `.env.example`.
3. Ejecutar pruebas de arranque limpio, reinicio y persistencia.
4. Probar integracion con backend y backup diario.
5. Probar restauracion en una base temporal.
6. Actualizar README y cerrar la especificacion con evidencias de validacion.
