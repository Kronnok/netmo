# Especificación: backup y restauración desde administración

## Objetivo y alcance

Proveer exportación y restauración JSON de datos de negocio desde el panel
administrativo, sin depender de herramientas de PostgreSQL del sistema.

## Comportamiento esperado

- Una migración nueva crea `audit_log`; `database/schema.sql` refleja la
  estructura vigente.
- Solo administradores pueden descargar backup o restaurar. El backup incluye
  usuarios y hashes, preferencias, inventario, reservas, préstamos,
  devoluciones, tickets y tardanzas; no incluye `password_resets`,
  `schema_migrations` ni auditoría.
- El documento incluye formato, versión de esquema, fecha, conteos, datos y
  checksum SHA-256. La descarga usa nombre con fecha y hora.
- La restauración valida formato/versión, checksum, estructura y enums,
  referencias y al menos un administrador; requiere contraseña actual y frase
  `RESTAURAR`. Rechaza esquemas futuros, admite backups viejos con columnas
  conocidas y defaults actuales, ejecuta reemplazo en una transacción y
  registra auditoría.
- Solo la ruta de restore acepta cuerpos de hasta 25 MB. Se bloquean
  restauraciones concurrentes.
- La UI permite descargar, previsualizar metadatos, advertir que reemplaza
  todos los datos, confirmar contraseña/frase y recargar tras éxito.
- `backups/` y `*.backup.json` quedan ignorados por Git. La documentación
  explica el carácter sensible del archivo, que incluye hashes de contraseña.

## Criterios de aceptación

1. Toda ruta está protegida por autorización admin.
2. Datos inválidos, password/frase incorrectos o fallos en una escritura
   producen rollback completo y respuesta 4xx clara.
3. Backup/restore usan la API de PostgreSQL, sin `pg_dump`/`pg_restore`.
4. Tests existentes y nuevos pasan sin apuntar a producción.
