CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('alumno', 'profesor', 'admin');
CREATE TYPE notebook_status AS ENUM ('disponible', 'prestada', 'mantenimiento', 'pendiente_devolucion');
CREATE TYPE reservation_type AS ENUM ('individual', 'lote');
CREATE TYPE reservation_status AS ENUM ('confirmada', 'pendiente_aprobacion', 'aprobada', 'rechazada', 'cancelada');
CREATE TYPE loan_status AS ENUM ('activo', 'devolucion_pendiente', 'devuelto');
CREATE TYPE ticket_status AS ENUM ('abierto', 'progreso', 'resuelto');

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  legajo VARCHAR(32) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  email CITEXT NOT NULL UNIQUE,
  curso VARCHAR(120) NOT NULL,
  rol user_role NOT NULL,
  password_hash TEXT NOT NULL,
  baneado BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  return_reminder_minutes INTEGER NOT NULL DEFAULT 30 CHECK (return_reminder_minutes IN (0, 15, 30, 60)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notebooks (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(32) NOT NULL UNIQUE,
  estado notebook_status NOT NULL DEFAULT 'disponible',
  ubicacion VARCHAR(80) NOT NULL,
  prestado_a BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((estado IN ('prestada', 'pendiente_devolucion')) = (prestado_a IS NOT NULL))
);

CREATE TABLE reservations (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(32) NOT NULL UNIQUE,
  owner_id BIGINT NOT NULL REFERENCES users(id),
  tipo reservation_type NOT NULL,
  carro VARCHAR(80),
  curso VARCHAR(120),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0 AND cantidad <= 40),
  retiro_at TIMESTAMPTZ NOT NULL,
  motivo TEXT NOT NULL DEFAULT 'Sin especificar',
  estado reservation_status NOT NULL DEFAULT 'confirmada',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((tipo = 'lote' AND curso IS NOT NULL AND btrim(curso) <> '' AND cantidad >= 3) OR (tipo = 'individual' AND cantidad <= 40))
);

CREATE TABLE reservation_notebooks (
  reservation_id BIGINT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  notebook_id BIGINT NOT NULL REFERENCES notebooks(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (reservation_id, notebook_id)
);

CREATE UNIQUE INDEX one_active_reservation_per_notebook
ON reservation_notebooks(notebook_id) WHERE active;

CREATE OR REPLACE FUNCTION validate_reservation_year()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXTRACT(YEAR FROM NEW.retiro_at) <> EXTRACT(YEAR FROM CURRENT_DATE) THEN
    RAISE EXCEPTION 'Las reservas solo pueden hacerse durante el año actual';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservations_current_year
BEFORE INSERT OR UPDATE OF retiro_at ON reservations
FOR EACH ROW EXECUTE FUNCTION validate_reservation_year();

CREATE OR REPLACE FUNCTION validate_reservation_schedule()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  local_time TIME;
  weekday INTEGER;
BEGIN
  local_time := NEW.retiro_at::TIME;
  weekday := EXTRACT(ISODOW FROM NEW.retiro_at);
  IF weekday > 5 THEN
    RAISE EXCEPTION 'Las reservas solo pueden hacerse de lunes a viernes';
  END IF;
    IF (weekday = 5 AND (local_time < TIME '09:30' OR local_time > TIME '17:30'))
      OR (weekday <> 5 AND (local_time < TIME '07:45' OR local_time > TIME '17:30')) THEN
    RAISE EXCEPTION 'El horario de retiro no esta disponible';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservations_schedule
BEFORE INSERT OR UPDATE OF retiro_at ON reservations
FOR EACH ROW EXECUTE FUNCTION validate_reservation_schedule();

CREATE TABLE loans (
  id BIGSERIAL PRIMARY KEY,
  notebook_id BIGINT NOT NULL REFERENCES notebooks(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  reservation_id BIGINT REFERENCES reservations(id),
  retirada_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence_at TIMESTAMPTZ NOT NULL,
  devuelta_at TIMESTAMPTZ,
  estado loan_status NOT NULL DEFAULT 'activo',
  CHECK ((estado = 'devuelto') = (devuelta_at IS NOT NULL))
);

CREATE UNIQUE INDEX one_open_loan_per_notebook ON loans(notebook_id) WHERE estado <> 'devuelto';

CREATE TABLE returns (
  id BIGSERIAL PRIMARY KEY,
  loan_id BIGINT NOT NULL UNIQUE REFERENCES loans(id),
  solicitado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmado_at TIMESTAMPTZ,
  confirmado_por BIGINT REFERENCES users(id),
  estado VARCHAR(24) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmada'))
);

CREATE TABLE tickets (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(32) NOT NULL UNIQUE,
  notebook_id BIGINT REFERENCES notebooks(id),
  owner_id BIGINT NOT NULL REFERENCES users(id),
  motivo VARCHAR(240) NOT NULL,
  descripcion TEXT NOT NULL,
  estado ticket_status NOT NULL DEFAULT 'abierto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES users(id),
  CHECK ((estado = 'resuelto') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);

CREATE TABLE late_returns (
  id BIGSERIAL PRIMARY KEY,
  loan_id BIGINT NOT NULL UNIQUE REFERENCES loans(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  notebook_id BIGINT NOT NULL REFERENCES notebooks(id),
  returned_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (returned_at > due_at)
);

CREATE INDEX reservations_owner_idx ON reservations(owner_id, retiro_at);
CREATE INDEX reservation_notebooks_active_idx ON reservation_notebooks(notebook_id) WHERE active;
CREATE INDEX tickets_owner_idx ON tickets(owner_id, created_at DESC);
CREATE INDEX tickets_active_idx ON tickets(estado) WHERE estado <> 'resuelto';
CREATE INDEX late_returns_user_idx ON late_returns(user_id, returned_at DESC);

CREATE OR REPLACE FUNCTION sync_late_return()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'devuelto' AND OLD.estado <> 'devuelto' AND NEW.devuelta_at > NEW.vence_at THEN
    INSERT INTO late_returns (loan_id, user_id, notebook_id, returned_at, due_at)
    VALUES (NEW.id, NEW.user_id, NEW.notebook_id, NEW.devuelta_at, NEW.vence_at)
    ON CONFLICT (loan_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER loans_late_return
AFTER UPDATE OF estado, devuelta_at ON loans
FOR EACH ROW EXECUTE FUNCTION sync_late_return();

CREATE VIEW user_late_return_summary AS
SELECT u.id, u.legajo, u.nombre, u.rol, COUNT(lr.id)::INTEGER AS tardanzas,
       COUNT(lr.id) >= 3 AS candidato_a_sancion
FROM users u
LEFT JOIN late_returns lr ON lr.user_id = u.id
WHERE u.rol <> 'admin'
GROUP BY u.id, u.legajo, u.nombre, u.rol;
