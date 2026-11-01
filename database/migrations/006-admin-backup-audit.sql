BEGIN;

CREATE OR REPLACE FUNCTION validate_reservation_year()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('netmo.restore_mode', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXTRACT(YEAR FROM NEW.retiro_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
    <> EXTRACT(YEAR FROM now() AT TIME ZONE 'America/Argentina/Buenos_Aires') THEN
    RAISE EXCEPTION 'Las reservas solo pueden hacerse durante el año actual';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_reservation_schedule()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  local_time TIME;
  weekday INTEGER;
BEGIN
  IF current_setting('netmo.restore_mode', TRUE) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.retiro_at <= now() THEN
    RAISE EXCEPTION 'La fecha y hora de reserva deben ser futuras';
  END IF;
  local_time := (NEW.retiro_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::TIME;
  weekday := EXTRACT(ISODOW FROM NEW.retiro_at AT TIME ZONE 'America/Argentina/Buenos_Aires');
  IF weekday > 5 THEN
    RAISE EXCEPTION 'Las reservas solo pueden hacerse de lunes a viernes';
  END IF;
  IF NOT ((local_time >= TIME '08:00' AND local_time <= TIME '11:50')
      OR (local_time >= TIME '13:30' AND local_time <= TIME '17:40')) THEN
    RAISE EXCEPTION 'Solo se pueden hacer reservas de 08:00 a 11:50 y de 13:30 a 17:40';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  accion VARCHAR(80) NOT NULL,
  detalle TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
