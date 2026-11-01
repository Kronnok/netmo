const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function businessTimeParts(date) {
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

function parseBusinessDateTime(value) {
  if (typeof value !== 'string') return null;
  if (/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
  const expected = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second)
  };
  const wallTime = Date.UTC(expected.year, expected.month - 1, expected.day, expected.hour, expected.minute, expected.second, Number(millisecond.padEnd(3, '0')));
  const wallDate = new Date(wallTime);
  if (wallDate.getUTCFullYear() !== expected.year || wallDate.getUTCMonth() + 1 !== expected.month
    || wallDate.getUTCDate() !== expected.day || expected.hour > 23 || expected.minute > 59 || expected.second > 59) {
    return null;
  }

  let instant = wallTime;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = businessTimeParts(new Date(instant));
    const representedWallTime = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second), Number(millisecond.padEnd(3, '0'))
    );
    instant += wallTime - representedWallTime;
  }
  const result = new Date(instant);
  const resolved = businessTimeParts(result);
  if (Number(resolved.year) !== expected.year || Number(resolved.month) !== expected.month
    || Number(resolved.day) !== expected.day || Number(resolved.hour) !== expected.hour
    || Number(resolved.minute) !== expected.minute || Number(resolved.second) !== expected.second) {
    return null;
  }
  return result;
}

function loanDueAt(retiradaAt, horaDevolucion = null) {
  const retirada = new Date(retiradaAt);
  if (Number.isNaN(retirada.getTime())) throw new TypeError('La fecha de retiro no es válida');
  const { year, month, day } = businessTimeParts(retirada);
  const cierre = parseBusinessDateTime(`${year}-${month}-${day}T17:30`);
  if (!cierre) throw new Error('No se pudo calcular el cierre del día hábil');
  if (horaDevolucion !== null && horaDevolucion !== undefined) {
    if (typeof horaDevolucion !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horaDevolucion)
      || Number(horaDevolucion.slice(0, 2)) * 60 + Number(horaDevolucion.slice(3, 5)) > 17 * 60 + 30) {
      throw new TypeError('La hora de devolución no es válida');
    }
    return parseBusinessDateTime(`${year}-${month}-${day}T${horaDevolucion}`);
  }
  return new Date(Math.min(retirada.getTime() + 8 * 60 * 60 * 1000, cierre.getTime()));
}

function reservationReturnTimeError(retiradaAt, value) {
  const message = 'La hora de devolución debe ser posterior al retiro y no superar las 17:30 del mismo día (Buenos Aires)';
  if (!(retiradaAt instanceof Date) || Number.isNaN(retiradaAt.getTime())
    || typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return message;
  const { year, month, day } = businessTimeParts(retiradaAt);
  const requested = parseBusinessDateTime(`${year}-${month}-${day}T${value}`);
  const minutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  if (!requested || requested.getTime() <= retiradaAt.getTime() || minutes > 17 * 60 + 30) return message;
  return null;
}

function reservationTimeError(reservationDate, now = new Date()) {
  if (reservationDate.getTime() <= now.getTime()) return 'La fecha y hora de reserva deben ser futuras';
  const requested = businessTimeParts(reservationDate);
  const current = businessTimeParts(now);
  if (requested.year !== current.year) return 'La reserva debe ser del año actual';
  const weekday = new Date(Date.UTC(Number(requested.year), Number(requested.month) - 1, Number(requested.day))).getUTCDay();
  if (weekday === 0 || weekday === 6) return 'Las reservas solo pueden hacerse de lunes a viernes';
  const minutes = Number(requested.hour) * 60 + Number(requested.minute);
  if (!((minutes >= 480 && minutes <= 710) || (minutes >= 810 && minutes <= 1060))) {
    return 'Solo se pueden hacer reservas de 08:00 a 11:50 y de 13:30 a 17:40';
  }
  return null;
}

module.exports = {
  TIME_ZONE,
  businessTimeParts,
  loanDueAt,
  parseBusinessDateTime,
  reservationReturnTimeError,
  reservationTimeError
};
