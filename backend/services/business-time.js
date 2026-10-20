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

function reservationTimeError(reservationDate, now = new Date()) {
  const requested = businessTimeParts(reservationDate);
  const current = businessTimeParts(now);
  if (requested.year !== current.year) return 'La reserva debe ser del año actual';
  const weekday = new Date(Date.UTC(Number(requested.year), Number(requested.month) - 1, Number(requested.day))).getUTCDay();
  if (weekday === 0 || weekday === 6) return 'Las reservas solo pueden hacerse de lunes a viernes';
  const minutes = Number(requested.hour) * 60 + Number(requested.minute);
  if (!((minutes >= 480 && minutes <= 730) || (minutes >= 810 && minutes <= 1050))) {
    return 'Solo se pueden hacer reservas de 08:00 a 12:10 y de 13:30 a 17:30';
  }
  return null;
}

module.exports = { TIME_ZONE, businessTimeParts, parseBusinessDateTime, reservationTimeError };
