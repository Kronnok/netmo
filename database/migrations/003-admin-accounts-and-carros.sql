BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS baneado_hasta TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS carros (
  numero INTEGER PRIMARY KEY CHECK (numero BETWEEN 1 AND 999),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE notebooks ADD COLUMN IF NOT EXISTS carro_id INTEGER REFERENCES carros(numero);

INSERT INTO carros (numero)
SELECT DISTINCT substring(ubicacion from '^Carro ([1-9][0-9]{0,2})$')::integer
FROM notebooks
WHERE ubicacion ~ '^Carro [1-9][0-9]{0,2}$'
ON CONFLICT (numero) DO NOTHING;

UPDATE notebooks
SET carro_id = substring(ubicacion from '^Carro ([1-9][0-9]{0,2})$')::integer
WHERE carro_id IS NULL AND ubicacion ~ '^Carro [1-9][0-9]{0,2}$';

COMMIT;
