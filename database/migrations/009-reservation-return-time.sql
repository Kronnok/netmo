BEGIN;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS hora_devolucion TIME;

COMMIT;
