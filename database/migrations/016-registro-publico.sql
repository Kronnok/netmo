-- Registro público: toda cuenta nueva queda pendiente hasta que un admin la apruebe.
ALTER TABLE users ADD COLUMN IF NOT EXISTS aprobado BOOLEAN NOT NULL DEFAULT TRUE;

-- Una solicitud @gmail.com queda sin rol hasta que el administrador se lo asigne.
ALTER TABLE users ALTER COLUMN rol DROP NOT NULL;

CREATE INDEX IF NOT EXISTS users_pendientes_idx
  ON users (created_at)
  WHERE aprobado = FALSE AND eliminado_at IS NULL;
