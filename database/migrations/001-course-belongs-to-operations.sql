BEGIN;

ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'retirada';

ALTER TABLE loans ADD COLUMN IF NOT EXISTS curso VARCHAR(120);

UPDATE loans AS l
SET curso = r.curso
FROM reservations AS r
WHERE l.reservation_id = r.id
  AND l.curso IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'curso'
  ) THEN
    UPDATE loans AS l
    SET curso = u.curso
    FROM users AS u
    WHERE l.user_id = u.id
      AND l.curso IS NULL;
  END IF;
END $$;

ALTER TABLE users DROP COLUMN IF EXISTS curso;

COMMIT;