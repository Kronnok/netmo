CREATE TABLE IF NOT EXISTS ubicaciones (
  slug VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL
);

INSERT INTO ubicaciones (slug, nombre) VALUES
  ('taller', 'Taller'),
  ('teoria_pb', 'Teoría – Planta baja'),
  ('teoria_p1', 'Teoría – 1.er piso'),
  ('teoria_p2', 'Teoría – 2.º piso')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE carros DROP CONSTRAINT IF EXISTS carros_ubicacion_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'carros_ubicacion_fkey'
  ) THEN
    ALTER TABLE carros
      ADD CONSTRAINT carros_ubicacion_fkey
      FOREIGN KEY (ubicacion) REFERENCES ubicaciones(slug) ON UPDATE CASCADE;
  END IF;
END;
$$;

ALTER TABLE loans ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ticket_replies (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mensaje VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_replies_ticket_idx
  ON ticket_replies(ticket_id, created_at);