-- Bloqueo automático por acumular cinco devoluciones tardías.
-- El contador se reinicia al desbloquear la cuenta (manual o por vencimiento)
-- sin borrar el historial de demoras.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS baneo_origen VARCHAR(16);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tardanzas_reset_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'users'::regclass AND conname = 'users_baneo_origen_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_baneo_origen_check
      CHECK (baneo_origen IS NULL OR baneo_origen IN ('manual', 'automatico'));
  END IF;
END $$;

DROP VIEW IF EXISTS user_late_return_summary;
CREATE VIEW user_late_return_summary AS
SELECT u.id, u.dni, u.nombre, u.rol, COUNT(lr.id)::INTEGER AS tardanzas,
       COUNT(lr.id) >= 3 AS candidato_a_sancion,
       COUNT(lr.id) >= 5 AS bloqueo_automatico
FROM users u
LEFT JOIN late_returns lr ON lr.user_id = u.id
  AND (u.tardanzas_reset_at IS NULL OR lr.returned_at >= u.tardanzas_reset_at)
WHERE u.rol <> 'admin'
GROUP BY u.id, u.dni, u.nombre, u.rol;

COMMIT;
