const lockMinutesSetting = process.env.LOGIN_LOCK_MINUTES?.trim();
const configuredMinutes = lockMinutesSetting ? Number(lockMinutesSetting) : 2;
const LOCK_MINUTES = Number.isSafeInteger(configuredMinutes) ? Math.max(1, configuredMinutes) : 2;
const WINDOW_MS = LOCK_MINUTES * 60 * 1000;
const MAX_FAILURES = 5;
const attempts = new Map();

function clientIp(request) {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

function keyFor(request, email, namespace = 'login') {
  return `${namespace}:${clientIp(request)}:${String(email || '').trim().toLowerCase()}`;
}

function isRateLimited(request, email, now = Date.now(), namespace = 'login') {
  const key = keyFor(request, email, namespace);
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    attempts.delete(key);
    return false;
  }
  return entry.failures >= MAX_FAILURES;
}

function recordFailure(request, email, now = Date.now(), namespace = 'login') {
  const key = keyFor(request, email, namespace);
  const entry = attempts.get(key);
  if (!entry || entry.expiresAt <= now) {
    attempts.set(key, { failures: 1, expiresAt: now + WINDOW_MS });
    return;
  }
  entry.failures += 1;
}

function clearFailures(request, email, namespace = 'login') {
  attempts.delete(keyFor(request, email, namespace));
}

function remainingMinutes(request, email, now = Date.now(), namespace = 'login') {
  const entry = attempts.get(keyFor(request, email, namespace));
  if (!entry || entry.expiresAt <= now) return 0;
  return Math.ceil((entry.expiresAt - now) / 60_000);
}

function reset() {
  attempts.clear();
}

module.exports = {
  isRateLimited,
  recordFailure,
  clearFailures,
  remainingMinutes,
  reset,
  MAX_FAILURES,
  LOCK_MINUTES,
  WINDOW_MS
};
