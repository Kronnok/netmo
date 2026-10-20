const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { after, test } = require('node:test');

process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/netmo_test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-hmac';

const db = require('../data/database');
const authService = require('../services/auth-service');
const apiService = require('../services/api-service');
const loginRateLimiter = require('../services/login-rate-limiter');
const routes = require('../routes');
const { createToken, verifyToken, TOKEN_LIFETIME_SECONDS } = require('../services/session-token');
const { parseBusinessDateTime, reservationTimeError, TIME_ZONE } = require('../services/business-time');

after(() => db.pool.end());

test('los tokens HMAC se verifican, no admiten alteraciones y vencen a las 12 horas', () => {
  const secret = 'unit-test-signing-secret';
  const now = Date.UTC(2026, 0, 5, 12);
  const token = createToken(42, secret, now);

  assert.deepEqual(verifyToken(token, secret, now), { userId: '42' });
  assert.equal(verifyToken(token, 'other-signing-secret', now), null);
  assert.equal(verifyToken(`${token.slice(0, -1)}x`, secret, now), null);
  assert.equal(verifyToken(token, secret, now + TOKEN_LIFETIME_SECONDS * 1000), null);
});

test('la configuración de producción requiere JWT_SECRET', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./config')"], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://frontend.test',
      JWT_SECRET: ''
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET es obligatorio en producción/);
});

test('las reservas interpretan fechas y horarios en Buenos Aires', () => {
  const mondayMorning = parseBusinessDateTime('2026-01-05T08:00');
  assert.equal(TIME_ZONE, 'America/Argentina/Buenos_Aires');
  assert.equal(mondayMorning.toISOString(), '2026-01-05T11:00:00.000Z');
  assert.equal(reservationTimeError(mondayMorning, new Date('2026-01-05T12:00:00Z')), null);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-10T09:00'), new Date('2026-01-05T12:00:00Z')), /lunes a viernes/);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-05T12:11'), new Date('2026-01-05T12:00:00Z')), /08:00 a 12:10/);
  assert.equal(reservationTimeError(parseBusinessDateTime('2026-01-05T13:30'), new Date('2026-01-05T12:00:00Z')), null);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-05T17:31'), new Date('2026-01-05T12:00:00Z')), /08:00 a 12:10/);
  assert.equal(parseBusinessDateTime('2026-02-30T10:00'), null);
});

test('cinco fallos de login por IP y correo bloquean el siguiente intento durante 15 minutos', async () => {
  const originalQuery = db.query;
  const request = { headers: {}, socket: { remoteAddress: '192.0.2.10' } };
  loginRateLimiter.reset();
  db.query = async () => ({ rows: [] });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        authService.login({ email: 'user@example.test', password: 'wrong' }, request),
        (error) => error.status === 401
      );
    }
    await assert.rejects(
      authService.login({ email: 'user@example.test', password: 'wrong' }, request),
      (error) => error.status === 429
    );
    assert.equal(loginRateLimiter.isRateLimited(
      { headers: {}, socket: { remoteAddress: '192.0.2.11' } },
      'user@example.test'
    ), false);
    assert.equal(loginRateLimiter.isRateLimited(request, 'USER@example.test', Date.now() + loginRateLimiter.WINDOW_MS), false);
  } finally {
    db.query = originalQuery;
    loginRateLimiter.reset();
  }
});

test('todos los servicios detrás de rutas admin rechazan alumnos y aceptan administradores', async () => {
  const paths = [
    ['GET', '/api/admin/professors'],
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/reservations'],
    ['POST', '/api/admin/reservations/8/approve'],
    ['POST', '/api/admin/reservations/8/reject'],
    ['POST', '/api/admin/reservations/8/checkout'],
    ['GET', '/api/admin/returns'],
    ['POST', '/api/admin/returns/8/confirm'],
    ['GET', '/api/admin/tickets'],
    ['GET', '/api/admin/late-returns'],
    ['PATCH', '/api/admin/users/U-8'],
    ['PATCH', '/api/admin/users/U-8/rol']
  ];
  const originalQuery = db.query;
  db.query = async () => ({ rows: [], rowCount: 1 });
  try {
    for (const [method, pathname] of paths) {
      const route = routes.resolve(method, pathname);
      assert.ok(route, `${method} ${pathname} debe estar registrada`);
      await assert.rejects(
        apiService[route.action]({}, { id: 1, rol: 'alumno' }, route.params),
        (error) => error.status === 403,
        `${method} ${pathname} debe rechazar alumnos`
      );
    }
    assert.deepEqual(await apiService.professors({}, { id: 1, rol: 'admin' }), { professors: [] });
  } finally {
    db.query = originalQuery;
  }
});

test('el rechazo de lote modifica el estado y libera equipos dentro de una transacción', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  let transactionCalls = 0;
  db.transaction = async (callback) => {
    transactionCalls += 1;
    return callback({
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes("UPDATE reservations SET estado = 'rechazada'")) {
          return { rowCount: 1, rows: [{ id: params[0] }] };
        }
        return { rowCount: 1, rows: [] };
      }
    });
  };
  try {
    assert.deepEqual(await apiService.rejectReservation({}, { id: 1, rol: 'admin' }, { id: 8 }), { message: 'Lote rechazado' });
    assert.equal(transactionCalls, 1);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /tipo = 'lote' AND estado IN \('pendiente_aprobacion', 'aprobada'\)/);
    assert.match(calls[1].sql, /UPDATE reservation_notebooks SET active = FALSE/);
    assert.deepEqual(calls[1].params, [8]);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('el registro requiere ocho caracteres y crea cuentas de rol alumno', async () => {
  const originalTransaction = db.transaction;
  let insertSql = '';
  db.transaction = async (callback) => callback({
    query: async (sql) => {
      if (sql.includes('INSERT INTO users')) {
        insertSql = sql;
        return { rows: [{ id: '5', legajo: 'U-5', nombre: 'Test User', email: 'user@example.test', rol: 'alumno' }] };
      }
      return { rowCount: 1 };
    }
  });
  try {
    await assert.rejects(
      authService.register({ nombre: 'Test User', email: 'short@example.test', password: 'short' }),
      (error) => error.status === 400
    );
    const result = await authService.register({ nombre: 'Test User', email: 'user@example.test', password: 'long-enough-password' });
    assert.equal(result.user.rol, 'alumno');
    assert.match(insertSql, /'alumno'/);
  } finally {
    db.transaction = originalTransaction;
  }
});
