-- Las cuentas dadas de baja se anonimizan para liberar el correo y el DNI y
-- permitir que la persona vuelva a registrarse, conservando el historial.
BEGIN;

UPDATE users SET
  nombre = 'Cuenta eliminada',
  email = 'eliminado+' || id || '@netmo.invalid',
  dni = 'ELIM-' || id,
  password_hash = crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')),
  baneado = FALSE,
  baneado_hasta = NULL,
  estado_registro = 'rechazado',
  registro_revisado_at = COALESCE(registro_revisado_at, now())
WHERE eliminado_at IS NOT NULL
  AND (email NOT LIKE 'eliminado+%@netmo.invalid' OR dni NOT LIKE 'ELIM-%');

DELETE FROM password_resets
WHERE user_id IN (SELECT id FROM users WHERE eliminado_at IS NOT NULL);

DELETE FROM user_preferences
WHERE user_id IN (SELECT id FROM users WHERE eliminado_at IS NOT NULL);

COMMIT;
