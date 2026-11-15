-- Las cuentas se dan de baja de forma lógica para conservar el historial de préstamos,
-- devoluciones y tardanzas. eliminado_at NULL indica una cuenta activa.
ALTER TABLE users ADD COLUMN IF NOT EXISTS eliminado_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS users_eliminado_at_idx
  ON users(eliminado_at) WHERE eliminado_at IS NOT NULL;
