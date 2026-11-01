BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'legajo'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'dni'
  ) THEN
    ALTER TABLE users RENAME COLUMN legajo TO dni;
  END IF;
END $$;

ALTER TABLE carros ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'carros'::regclass AND conname = 'carros_ubicacion_check'
  ) THEN
    ALTER TABLE carros ADD CONSTRAINT carros_ubicacion_check
      CHECK (ubicacion IS NULL OR ubicacion IN ('taller', 'teoria_pb', 'teoria_p1', 'teoria_p2'));
  END IF;
END $$;

ALTER TABLE notebooks DROP CONSTRAINT IF EXISTS notebooks_carro_id_fkey;
ALTER TABLE notebooks ADD CONSTRAINT notebooks_carro_id_fkey
  FOREIGN KEY (carro_id) REFERENCES carros(numero) ON UPDATE CASCADE;

DROP VIEW IF EXISTS user_late_return_summary;
CREATE VIEW user_late_return_summary AS
SELECT u.id, u.dni, u.nombre, u.rol, COUNT(lr.id)::INTEGER AS tardanzas,
       COUNT(lr.id) >= 3 AS candidato_a_sancion
FROM users u
LEFT JOIN late_returns lr ON lr.user_id = u.id
WHERE u.rol <> 'admin'
GROUP BY u.id, u.dni, u.nombre, u.rol;

CREATE INDEX IF NOT EXISTS users_rol_nombre_idx ON users(rol, nombre);
CREATE INDEX IF NOT EXISTS notebooks_carro_estado_idx ON notebooks(carro_id, estado);

COMMIT;
