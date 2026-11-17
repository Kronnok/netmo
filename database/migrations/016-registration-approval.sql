-- Registro público con aprobación administrativa.
-- Las cuentas existentes y las creadas por administración quedan aprobadas.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registration_status') THEN
    EXECUTE 'CREATE TYPE registration_status AS ENUM (''pendiente'', ''aprobado'', ''rechazado'')';
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS estado_registro registration_status NOT NULL DEFAULT 'aprobado';
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registro_revisado_at TIMESTAMPTZ;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS registro_revisado_por BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_estado_registro_idx
  ON users(estado_registro) WHERE estado_registro <> 'aprobado';

COMMIT;
