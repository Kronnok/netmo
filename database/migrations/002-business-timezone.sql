BEGIN;

CREATE OR REPLACE FUNCTION validate_reservation_year()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
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
  local_time := (NEW.retiro_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::TIME;
  weekday := EXTRACT(ISODOW FROM NEW.retiro_at AT TIME ZONE 'America/Argentina/Buenos_Aires');
  IF weekday > 5 THEN
    RAISE EXCEPTION 'Las reservas solo pueden hacerse de lunes a viernes';
  END IF;
  IF NOT ((local_time >= TIME '08:00' AND local_time <= TIME '12:10')
      OR (local_time >= TIME '13:30' AND local_time <= TIME '17:30')) THEN
    RAISE EXCEPTION 'Solo se pueden hacer reservas de 08:00 a 12:10 y de 13:30 a 17:30';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
