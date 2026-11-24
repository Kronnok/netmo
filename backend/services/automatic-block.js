// Reglas del bloqueo automático por entregas tardías.
const AUTOMATIC_BLOCK_THRESHOLD = 5;
const AUTOMATIC_BLOCK_DAYS = 7;

function activeBan(banned, banExpiresAt, now) {
  if (!banned) return false;
  if (!banExpiresAt) return true;
  const expiresAt = banExpiresAt instanceof Date ? banExpiresAt : new Date(banExpiresAt);
  return Number.isFinite(expiresAt.getTime()) && expiresAt > now;
}

function shouldBlockAutomatically({ role, totalLateReturns, banned, banExpiresAt }, now = new Date()) {
  if (role === 'admin') return false;
  if (Number(totalLateReturns) < AUTOMATIC_BLOCK_THRESHOLD) return false;
  return !activeBan(banned, banExpiresAt, now);
}

module.exports = {
  AUTOMATIC_BLOCK_THRESHOLD,
  AUTOMATIC_BLOCK_DAYS,
  activeBan,
  shouldBlockAutomatically
};
