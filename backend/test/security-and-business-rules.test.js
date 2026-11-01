const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { after, test } = require('node:test');

process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/netmo_test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-hmac';

const db = require('../data/database');
const authService = require('../services/auth-service');
const apiService = require('../services/api-service');
const controller = require('../controllers/api-controller');
const loginRateLimiter = require('../services/login-rate-limiter');
const routes = require('../routes');
const { createToken, verifyToken, TOKEN_LIFETIME_SECONDS } = require('../services/session-token');
const {
  loanDueAt,
  parseBusinessDateTime,
  reservationTimeError,
  TIME_ZONE
} = require('../services/business-time');
const {
  accountEmail,
  accountPassword,
  courseDivision,
  dniIdentifier,
  personName,
  requiredText
} = require('../services/validation');

after(() => db.pool.end());

test('los tokens HMAC se verifican, no admiten alteraciones y vencen a las 12 horas', () => {
  const secret = 'unit-test-signing-secret';
  const now = Date.UTC(2026, 0, 5, 12);
  const token = createToken(42, secret, now);

  assert.deepEqual(verifyToken(token, secret, now), {
    userId: '42',
    expiresAt: Math.floor(now / 1000) + TOKEN_LIFETIME_SECONDS
  });
  assert.equal(verifyToken(token, 'other-signing-secret', now), null);
  assert.equal(verifyToken(`${token.slice(0, -1)}x`, secret, now), null);
  assert.equal(verifyToken(token, secret, now + TOKEN_LIFETIME_SECONDS * 1000), null);
});

test('las altas validan DNI numérico de 7 u 8 dígitos sin alterar ceros iniciales', () => {
  assert.equal(dniIdentifier('0123456'), '0123456');
  assert.equal(dniIdentifier('01234567'), '01234567');
  for (const invalid of ['', '123456', '123456789', '12A4567', 1234567, null]) {
    assert.throws(
      () => dniIdentifier(invalid),
      (error) => error.status === 400
    );
  }
  assert.throws(() => dniIdentifier('123456'), /DNI debe contener 7 u 8 dígitos numéricos/);
});

test('refresh renueva un token válido y consulta el rol actual del usuario', async () => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql) => {
    queries.push(sql);
    if (sql.includes('SELECT id, dni, nombre, email, rol')) {
      return {
        rowCount: 1,
        rows: [{ id: '42', dni: '1234567', nombre: 'Ana', email: 'ana@example.test', rol: 'profesor', baneado: false }]
      };
    }
    return { rowCount: 1, rows: [] };
  };
  try {
    const route = routes.resolve('POST', '/api/auth/refresh');
    assert.equal(route.action, 'refresh');
    const refreshed = await authService.refresh({
      headers: { authorization: `Bearer ${createToken(42)}` },
      socket: { remoteAddress: '192.0.2.42' }
    });
    assert.equal(verifyToken(refreshed.token).userId, '42');
    assert.equal(queries.length, 2);
    assert.match(queries[1], /SELECT id, dni, nombre, email, rol/);
  } finally {
    db.query = originalQuery;
  }
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
  const beforeOpening = new Date('2026-01-05T06:00:00Z');
  assert.equal(reservationTimeError(mondayMorning, beforeOpening), null);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-10T09:00'), beforeOpening), /lunes a viernes/);
  assert.equal(reservationTimeError(parseBusinessDateTime('2026-01-05T11:50'), beforeOpening), null);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-05T11:51'), beforeOpening), /08:00 a 11:50/);
  assert.equal(reservationTimeError(parseBusinessDateTime('2026-01-05T13:30'), beforeOpening), null);
  assert.equal(reservationTimeError(parseBusinessDateTime('2026-01-05T17:40'), beforeOpening), null);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-05T17:41'), beforeOpening), /08:00 a 11:50/);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-05T08:59'), new Date('2026-01-05T12:00:00Z')), /deben ser futuras/);
  assert.match(reservationTimeError(parseBusinessDateTime('2026-01-05T09:00'), new Date('2026-01-05T12:00:00Z')), /deben ser futuras/);
  assert.equal(parseBusinessDateTime('2026-02-30T10:00'), null);
});

test('el vencimiento de préstamos usa Buenos Aires', () => {
  assert.equal(loanDueAt(parseBusinessDateTime('2026-01-05T08:00')).toISOString(), '2026-01-05T19:00:00.000Z');
  assert.equal(loanDueAt(parseBusinessDateTime('2026-01-05T10:00')).toISOString(), '2026-01-05T20:30:00.000Z');
  assert.equal(loanDueAt(parseBusinessDateTime('2026-01-05T10:00'), '16:45').toISOString(), '2026-01-05T19:45:00.000Z');
  assert.throws(() => loanDueAt(parseBusinessDateTime('2026-01-05T10:00'), '17:31'), /hora de devolución/);
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

test('el alta y el login preservan la clave, y solo los fallos cuentan para el limitador', async () => {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const password = 'Abcd1234';
  const legacyPassword = ' x ';
  const createdUser = {
    id: '909',
    dni: '9900991',
    nombre: 'Usuario Prueba',
    email: 'login-regression@example.test',
    rol: 'alumno',
    baneado: false
  };
  let savedPassword;
  let loginQuery;
  let loginQueryCount = 0;
  const request = { headers: {}, socket: { remoteAddress: '192.0.2.12' } };
  loginRateLimiter.reset();
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      if (sql.includes('INSERT INTO users')) {
        savedPassword = params[4];
        return { rows: [createdUser], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  });
  db.query = async (sql, params) => {
    if (sql.includes('password_hash = crypt')) {
      loginQueryCount += 1;
      loginQuery = { sql, params };
      return [password, legacyPassword].includes(params[1])
        ? { rows: [createdUser], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  };

  try {
    await apiService.createUser({
      nombre: 'Usuario',
      apellido: 'Prueba',
      email: createdUser.email,
      dni: createdUser.dni,
      rol: 'alumno',
      password
    }, { id: '1', rol: 'admin' });
    assert.equal(savedPassword, password);

    const accepted = await authService.login(
      { email: 'LOGIN-REGRESSION@EXAMPLE.TEST', password },
      request
    );
    assert.equal(accepted.user.id, createdUser.id);
    assert.equal(loginQueryCount, 1, 'login debe resolverse con una sola consulta a la base');
    assert.match(loginQuery.sql, /password_hash = crypt\(\$2, password_hash\)/);
    assert.deepEqual(loginQuery.params, [createdUser.email, password]);

    await assert.rejects(
      authService.login({ email: createdUser.email, password: 'incorrecta' }, request),
      (error) => error.status === 401
    );
    const legacyLogin = await authService.login(
      { email: createdUser.email, password: legacyPassword },
      request
    );
    assert.equal(legacyLogin.user.id, createdUser.id);
    assert.equal(loginQuery.params[1], legacyPassword);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        authService.login({ email: createdUser.email, password: 'incorrecta' }, request),
        (error) => error.status === 401
      );
    }
    await assert.rejects(
      authService.login({ email: createdUser.email, password: 'incorrecta' }, request),
      (error) => error.status === 429
    );
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
    loginRateLimiter.reset();
  }
});

test('todos los servicios detrás de rutas admin rechazan alumnos y aceptan administradores', async () => {
  const paths = [
    ['GET', '/api/admin/professors'],
    ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users'],
    ['GET', '/api/admin/carros'],
    ['POST', '/api/admin/carros'],
    ['PATCH', '/api/admin/carros/12'],
    ['DELETE', '/api/admin/carros/12'],
    ['POST', '/api/admin/notebooks'],
    ['GET', '/api/admin/reservations'],
    ['POST', '/api/admin/reservations/8/approve'],
    ['POST', '/api/admin/reservations/8/reject'],
    ['POST', '/api/admin/reservations/8/checkout'],
    ['GET', '/api/admin/returns'],
    ['GET', '/api/admin/open-loans'],
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

test('el listado admin incluye préstamos sin devolver y restringe su consulta', async () => {
  const originalQuery = db.query;
  const rows = [
    { id: '81', notebook: 'NB-081', estado: 'activo', return_id: null },
    { id: '82', notebook: 'NB-082', estado: 'devolucion_pendiente', return_id: '91' }
  ];
  let queryText = '';
  db.query = async (sql) => {
    queryText = sql.replace(/\s+/g, ' ');
    return { rows, rowCount: rows.length };
  };
  try {
    const result = await apiService.adminOpenLoans({}, { id: '1', rol: 'admin' });
    assert.deepEqual(result.loans, rows);
    assert.match(queryText, /l\.estado IN \('activo', 'devolucion_pendiente'\)/);
    assert.match(queryText, /LEFT JOIN returns r ON r\.loan_id = l\.id AND r\.estado = 'pendiente'/);
    await assert.rejects(
      apiService.adminOpenLoans({}, { id: '2', rol: 'profesor' }),
      (error) => error.status === 403
    );
  } finally {
    db.query = originalQuery;
  }
});

test('el rechazo de reservas modifica el estado y libera equipos dentro de una transacción', async () => {
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
    assert.deepEqual(await apiService.rejectReservation({}, { id: 1, rol: 'admin' }, { id: 8 }), { message: 'Solicitud rechazada' });
    assert.equal(transactionCalls, 1);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /estado IN \('pendiente_aprobacion', 'aprobada'\)/);
    assert.doesNotMatch(calls[0].sql, /tipo =/);
    assert.match(calls[1].sql, /UPDATE reservation_notebooks SET active = FALSE/);
    assert.deepEqual(calls[1].params, [8]);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('admin puede aprobar una reserva individual pendiente y completar sus asignaciones', async () => {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const calls = [];
  db.query = async () => ({ rowCount: 0, rows: [] });
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, owner_id, cantidad, carro FROM reservations')) {
        return { rowCount: 1, rows: [{ id: 9, owner_id: 4, cantidad: 2, carro: '1', tipo: 'individual' }] };
      }
      if (sql.includes('SELECT rn.notebook_id FROM reservation_notebooks')) return { rowCount: 0, rows: [] };
      if (sql.includes('SELECT n.id FROM notebooks n')) return { rowCount: 2, rows: [{ id: 21 }, { id: 22 }] };
      return { rowCount: 1, rows: [] };
    }
  });
  try {
    const result = await apiService.approveReservation({}, { id: 1, rol: 'admin' }, { id: 9 });
    assert.deepEqual(result, { message: 'Solicitud aprobada' });
    assert.match(calls[0].sql, /WHERE id = \$1 AND estado = 'pendiente_aprobacion'/);
    assert.doesNotMatch(calls[0].sql, /tipo =/);
    assert.ok(calls.some(({ sql }) => sql.includes("UPDATE reservations SET estado = 'aprobada'")));
    assert.equal(calls.filter(({ sql }) => sql.includes('INSERT INTO reservation_notebooks')).length, 2);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('las altas administrativas validan cuenta, almacenan hashes y crean preferencias iniciales', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  let duplicateAccount = false;
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO users')) {
        if (duplicateAccount) {
          const error = new Error('duplicate key');
          error.code = '23505';
          throw error;
        }
        return { rows: [{ id: '5', dni: '1234567', nombre: 'Ana Pérez', email: 'user@example.test', rol: 'alumno' }] };
      }
      return { rowCount: 1 };
    }
  });
  try {
    await assert.rejects(
      apiService.createUser({ nombre: 'A ', apellido: 'Pérez', email: 'short@example.test', dni: '1234567', rol: 'alumno', password: 'short' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.test', dni: '123456', rol: 'alumno', password: 'long-enough' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400 && /DNI.*7 u 8 dígitos/.test(error.message)
    );
    const result = await apiService.createUser({
      nombre: 'Ana', apellido: 'Pérez', email: 'USER@example.test', dni: '1234567', rol: 'alumno', password: 'long-enough'
    }, { id: 1, rol: 'admin' });
    assert.equal(result.user.email, 'user@example.test');
    assert.equal(result.user.rol, 'alumno');
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /crypt\(\$5, gen_salt\('bf'\)\)/);
    assert.deepEqual(calls[0].params.slice(0, 4), ['1234567', 'Ana Pérez', 'user@example.test', 'alumno']);
    assert.match(calls[1].sql, /INSERT INTO user_preferences/);
    assert.deepEqual(calls[1].params, ['5']);
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'bad email@example.test', dni: '1234567', rol: 'alumno', password: 'long-enough' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'ana@bad@domain.test', dni: '1234567', rol: 'alumno', password: 'long-enough' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'ok@example.test', dni: '1234567', rol: 'alumno', password: 'long pass' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    duplicateAccount = true;
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.test', dni: '1234567', rol: 'alumno', password: 'long-enough' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 409
    );
  } finally {
    db.transaction = originalTransaction;
  }
});

test('el cambio de rol protege auto-cambio, último admin y ascenso con contraseña, y audita sin DNI', async () => {
  const originalTransaction = db.transaction;
  const actor = { id: '1', dni: '1111111', email: 'admin@example.test', rol: 'admin' };
  let target = { id: '2', dni: '2222222', nombre: 'Ana', email: 'ana@example.test', rol: 'alumno' };
  let adminCount = 2;
  let passwordValid = true;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, dni, nombre, email, rol FROM users WHERE dni')) {
        return { rowCount: target ? 1 : 0, rows: target ? [{ ...target }] : [] };
      }
      if (sql.includes('password_hash = crypt')) return { rows: [{ valid: passwordValid }], rowCount: 1 };
      if (sql.includes("COUNT(*)::integer AS total FROM users WHERE rol = 'admin'")) {
        return { rows: [{ total: adminCount }], rowCount: 1 };
      }
      if (sql.includes('UPDATE users SET rol =')) {
        target = { ...target, rol: params[0] };
        return { rows: [{ dni: target.dni, nombre: target.nombre, email: target.email, rol: target.rol }], rowCount: 1 };
      }
      if (sql.includes("to_regclass('public.audit_log')")) return { rows: [{ table_name: 'audit_log' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }
  });
  try {
    target = { id: actor.id, dni: actor.dni, nombre: 'Admin', email: actor.email, rol: 'admin' };
    await assert.rejects(
      apiService.updateUserRole({ rol: 'profesor' }, actor, { dni: actor.dni }),
      (error) => error.status === 403 && /propio rol/.test(error.message)
    );

    target = { id: '2', dni: '2222222', nombre: 'Ana', email: 'ana@example.test', rol: 'alumno' };
    await assert.rejects(
      apiService.updateUserRole({ rol: 'admin' }, actor, { dni: target.dni }),
      (error) => error.status === 400 && /Confirmá tu contraseña/.test(error.message)
    );
    passwordValid = false;
    await assert.rejects(
      apiService.updateUserRole({ rol: 'admin', password: 'incorrecta' }, actor, { dni: target.dni }),
      (error) => error.status === 403 && /contraseña/.test(error.message)
    );
    passwordValid = true;
    const promoted = await apiService.updateUserRole(
      { rol: 'admin', password: 'correcta' }, actor, { dni: target.dni }
    );
    assert.equal(promoted.user.rol, 'admin');
    const audit = calls.find(call => call.sql.includes('INSERT INTO audit_log'));
    assert.ok(audit);
    assert.doesNotMatch(audit.params[1], /2222222|dni/i);

    target = { id: '2', dni: '2222222', nombre: 'Ana', email: 'ana@example.test', rol: 'admin' };
    adminCount = 1;
    await assert.rejects(
      apiService.updateUserRole({ rol: 'profesor' }, actor, { dni: target.dni }),
      (error) => error.status === 409 && /sin administradores/.test(error.message)
    );
  } finally {
    db.transaction = originalTransaction;
  }
});

test('rechaza reservas pasadas y valida el texto de tickets antes de persistir', async () => {
  for (const [user, tipo, cantidad] of [
    [{ id: '7', rol: 'alumno' }, 'individual', 1],
    [{ id: '8', rol: 'profesor' }, 'lote', 3]
  ]) {
    await assert.rejects(
      apiService.createReservation({ tipo, cantidad, curso: '6° Informática', retiroAt: '2000-01-03T09:00' }, user),
      (error) => error.status === 400 && /deben ser futuras/.test(error.message)
    );
  }
  const user = { id: '7', rol: 'profesor' };
  await assert.rejects(
    apiService.createTicket({ motivo: '   ', descripcion: 'Detalle válido' }, user),
    (error) => error.status === 400 && /no puede estar vacío/.test(error.message)
  );
  await assert.rejects(
    apiService.createTicket({ motivo: 'Motivo', descripcion: 'x'.repeat(4001) }, user),
    (error) => error.status === 400 && /50 caracteres/.test(error.message)
  );
});

test('los valores de texto nuevos se recortan y respetan 50 caracteres', () => {
  assert.equal(personName(` ${'A'.repeat(50)} `, 'El nombre'), 'A'.repeat(50));
  assert.throws(() => personName('A'.repeat(51), 'El nombre'), (error) => error.status === 400 && /50 caracteres/.test(error.message));
  assert.equal(accountEmail(`${'a'.repeat(37)}@example.test`), `${'a'.repeat(37)}@example.test`);
  assert.throws(() => accountEmail(`${'a'.repeat(38)}@example.test`), (error) => error.status === 400 && /50 caracteres/.test(error.message));
  assert.equal(accountPassword('x'.repeat(50)), 'x'.repeat(50));
  assert.throws(() => accountPassword('x'.repeat(51)), (error) => error.status === 400 && /50 caracteres/.test(error.message));
  assert.equal(requiredText('x'.repeat(50), 'El motivo'), 'x'.repeat(50));
  assert.throws(() => requiredText('x'.repeat(51), 'El motivo'), (error) => error.status === 400 && /50 caracteres/.test(error.message));
  assert.throws(() => requiredText('   ', 'El motivo'), (error) => error.status === 400 && /vacío/.test(error.message));
  assert.equal(courseDivision(' 2°14° '), '2°14°');
  assert.equal(dniIdentifier('1234567'), '1234567');
  assert.equal(dniIdentifier('12345678'), '12345678');
  for (const invalid of ['123456', '123456789', '1234A67']) {
    assert.throws(() => dniIdentifier(invalid), (error) => error.status === 400 && /7 u 8 dígitos/.test(error.message));
  }
  assert.throws(() => dniIdentifier(''), (error) => error.status === 400 && /no puede estar vacío/.test(error.message));
  for (const invalid of ['2°0°', '8°1°', '2°100°', '6° Informática']) {
    assert.throws(() => courseDivision(invalid), (error) => error.status === 400);
  }
});

test('el login no aplica el máximo de 50 caracteres a cuentas preexistentes', async () => {
  const originalQuery = db.query;
  const email = `${'a'.repeat(42)}@example.test`;
  const password = 'p'.repeat(64);
  loginRateLimiter.reset();
  db.query = async (sql, params) => sql.includes('password_hash = crypt')
    ? { rows: [{ id: '77', email, password, rol: 'alumno', baneado: false }], rowCount: 1 }
    : { rows: [], rowCount: 1 };
  try {
    const result = await authService.login({ email, password }, { headers: {}, socket: { remoteAddress: '192.0.2.77' } });
    assert.equal(result.user.id, '77');
  } finally {
    db.query = originalQuery;
    loginRateLimiter.reset();
  }
});

test('GET /api/carros requiere autenticación y devuelve disponibilidad por carro', async () => {
  const originalQuery = db.query;
  const originalAuthenticate = authService.authenticate;
  const calls = [];
  db.query = async (sql) => {
    calls.push(sql);
    return { rows: [{ numero: 2, ubicacion: 'teoria_pb', total: 5, disponibles: 4 }], rowCount: 1 };
  };
  try {
    const route = routes.resolve('GET', '/api/carros');
    assert.equal(route.action, 'availableCarros');
    assert.deepEqual(await apiService[route.action]({}, { id: 7, rol: 'alumno' }), {
      carros: [{ numero: 2, ubicacion: 'teoria_pb', total: 5, disponibles: 4 }]
    });
    assert.match(calls[0], /NOT EXISTS/);
    authService.authenticate = async () => {
      const error = new Error('No autenticado');
      error.status = 401;
      throw error;
    };
    const request = Readable.from([]);
    request.method = 'GET';
    request.url = '/api/carros';
    request.headers = {};
    const response = {
      writeHead(status) { this.status = status; },
      end(serialized) { this.payload = serialized ? JSON.parse(serialized) : null; }
    };
    await controller.handle(request, response, route, {});
    assert.equal(response.status, 401);
  } finally {
    authService.authenticate = originalAuthenticate;
    db.query = originalQuery;
  }
});

test('las reservas individuales y por lote asignan solo el carro seleccionado', async () => {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const calls = [];
  let availableCount = 0;
  let insertedReservations = 0;
  let selectedCarroExists = true;
  db.query = async () => ({ rowCount: 0, rows: [] });
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT 1 FROM loans WHERE user_id')) return { rowCount: 0, rows: [] };
      if (sql.includes('SELECT numero, ubicacion FROM carros WHERE numero =')) {
        return {
          rowCount: selectedCarroExists ? 1 : 0,
          rows: selectedCarroExists ? [{ numero: params[0], ubicacion: 'teoria_pb' }] : []
        };
      }
      if (sql.includes('SELECT n.id FROM notebooks n')) {
        return { rowCount: availableCount, rows: Array.from({ length: availableCount }, (_value, index) => ({ id: index + 1 })) };
      }
      if (sql.includes('INSERT INTO reservations')) {
        insertedReservations += 1;
        return { rowCount: 1, rows: [{ id: insertedReservations, tipo: params[2], cantidad: params[5], estado: params[9] }] };
      }
      return { rowCount: 1, rows: [] };
    }
  });
  const now = new Date();
  const retiroAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  retiroAt.setUTCHours(14, 0, 0, 0);
  const request = (tipo, cantidad) => ({
    tipo, cantidad, carro: '2', ubicacion: 'todas', curso: '6°14°',
    retiroAt: retiroAt.toISOString(), horaDevolucion: '17:00', motivo: 'Trabajo'
  });
  try {
    for (const horaDevolucion of [undefined, '11:00', '17:31']) {
      const invalid = request('individual', 1);
      if (horaDevolucion === undefined) delete invalid.horaDevolucion;
      else invalid.horaDevolucion = horaDevolucion;
      await assert.rejects(
        apiService.createReservation(invalid, { id: 1, rol: 'alumno' }),
        (error) => error.status === 400 && /hora de devolución/i.test(error.message)
      );
    }
    await assert.rejects(
      apiService.createReservation({ ...request('individual', 1), carro: '' }, { id: 1, rol: 'alumno' }),
      (error) => error.status === 400 && /carro.*vacío/i.test(error.message)
    );
    selectedCarroExists = false;
    await assert.rejects(
      apiService.createReservation(request('individual', 1), { id: 1, rol: 'alumno' }),
      (error) => error.status === 400 && /carro seleccionado no existe/i.test(error.message)
    );
    selectedCarroExists = true;
    await assert.rejects(
      apiService.createReservation({ ...request('individual', 1), ubicacion: 'taller' }, { id: 1, rol: 'alumno' }),
      (error) => error.status === 400 && /no pertenece a la ubicación/.test(error.message)
    );
    for (const [user, tipo, cantidad] of [
      [{ id: 2, rol: 'profesor' }, 'individual', 3],
      [{ id: 2, rol: 'profesor' }, 'lote', 2],
      [{ id: 2, rol: 'profesor' }, 'lote', 11],
      [{ id: 1, rol: 'alumno' }, 'individual', 2]
    ]) {
      await assert.rejects(
        apiService.createReservation(request(tipo, cantidad), user),
        (error) => error.status === (tipo === 'lote' && user.rol !== 'profesor' ? 403 : 400)
      );
    }
    for (const [user, tipo, cantidad] of [
      [{ id: 1, rol: 'alumno' }, 'individual', 1],
      [{ id: 2, rol: 'profesor' }, 'individual', 2],
      [{ id: 2, rol: 'profesor' }, 'lote', 3],
      [{ id: 2, rol: 'profesor' }, 'lote', 10]
    ]) {
      availableCount = 0;
      await assert.rejects(
        apiService.createReservation(request(tipo, cantidad), user),
        (error) => error.status === 409 && /carro seleccionado/.test(error.message)
      );
    }
    assert.equal(insertedReservations, 0);
    availableCount = 1;
    await apiService.createReservation(request('individual', 1), { id: 1, rol: 'alumno' });
    availableCount = 2;
    const individual = await apiService.createReservation(request('individual', 2), { id: 2, rol: 'profesor' });
    assert.equal(individual.reservation.estado, 'pendiente_aprobacion');
    availableCount = 3;
    const batch = await apiService.createReservation(request('lote', 3), { id: 2, rol: 'profesor' });
    assert.equal(batch.reservation.estado, 'pendiente_aprobacion');
    availableCount = 10;
    const largestBatch = await apiService.createReservation(request('lote', 10), { id: 2, rol: 'profesor' });
    assert.equal(largestBatch.reservation.cantidad, 10);
    assert.equal(insertedReservations, 4);
    const allocationCalls = calls.filter(call => call.sql.includes('SELECT n.id FROM notebooks n'));
    assert.ok(allocationCalls.every(call => call.params[0] === 2 && /n\.carro_id = \$1/.test(call.sql)));
    assert.ok(allocationCalls.every(call => /FOR UPDATE SKIP LOCKED/.test(call.sql)));
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('los baneos aceptan solo duraciones previstas y los vencidos vuelven a autenticarse', async () => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('UPDATE users SET baneado = $1')) {
    return { rowCount: 1, rows: [{ dni: '1234567', nombre: 'Ana Pérez', baneado: true, baneado_hasta: null }] };
    }
    if (sql.includes('password_hash = crypt')) {
    return { rowCount: 1, rows: [{ id: '5', dni: '1234567', nombre: 'Ana Pérez', email: 'ana@example.test', rol: 'alumno', baneado: false }] };
    }
    return { rowCount: 1, rows: [] };
  };
  loginRateLimiter.reset();
  try {
    await assert.rejects(
      apiService.updateUser({ baneado: true, duracionDias: 2 }, { id: 1, rol: 'admin' }, { dni: '1234567' }),
      (error) => error.status === 400
    );
    await apiService.updateUser({ baneado: true, duracionDias: 3 }, { id: 1, rol: 'admin' }, { dni: '1234567' });
    assert.deepEqual(queries[0].params, [true, '1234567', 3]);
    assert.match(queries[0].sql, /now\(\) \+ \(\$3::text \|\| ' days'\)::interval/);

    const result = await authService.login(
      { email: 'ANA@example.test', password: 'existing-pass' },
      { headers: {}, socket: { remoteAddress: '192.0.2.30' } }
    );
    assert.equal(result.user.baneado, false);
    assert.match(queries[1].sql, /baneado_hasta <= now\(\)/);
    assert.match(queries[1].sql, /baneado_hasta > now\(\)/);
    assert.equal(queries[1].params[0], 'ana@example.test');
    assert.equal(queries.length, 2);
  } finally {
    db.query = originalQuery;
    loginRateLimiter.reset();
  }
});

test('carros, series de notebooks y cambios de estado validan entradas', async () => {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const insertedCodes = [];
  db.query = async (sql, params) => {
    if (sql.includes('INSERT INTO carros')) return { rowCount: 1, rows: [{ numero: params[0] }] };
    return { rowCount: 1, rows: [] };
  };
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      if (sql.includes('SELECT numero FROM carros')) return { rowCount: 1, rows: [{ numero: params[0] }] };
      if (sql.includes('SELECT codigo FROM notebooks')) return { rowCount: 0, rows: [] };
      if (sql.includes('INSERT INTO notebooks')) {
        insertedCodes.push(params[0]);
        return { rowCount: 1, rows: [{ id: params[0], carro_id: params[2] }] };
      }
      return { rowCount: 1, rows: [] };
    }
  });
  try {
    await apiService.createCarro({ numero: 9 }, { id: 1, rol: 'admin' });
    const created = await apiService.createNotebooks({ numero: '997', carro_id: 9, cantidad: 3 }, { id: 1, rol: 'admin' });
    assert.deepEqual(insertedCodes, ['NB-997', 'NB-998', 'NB-999']);
    assert.equal(created.notebooks.length, 3);
    await assert.rejects(
      apiService.createNotebooks({ numero: '999', carro_id: 9, cantidad: 2 }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.createNotebooks({ numero: '1', carro_id: 9, cantidad: 11 }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.updateNotebook({ estado: 'prestada' }, { id: 1, rol: 'admin' }, { code: 'NB-997' }),
      (error) => error.status === 400
    );
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('admin edita o renumera carros y solo elimina carros sin notebooks', async () => {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  let duplicate = false;
  let carExists = true;
  let hasNotebooks = true;
  let deletionAllowed = false;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (duplicate) {
      const error = new Error('duplicate key');
      error.code = '23505';
      throw error;
    }
    return { rowCount: 1, rows: [{ numero: params[1], ubicacion: params[2] }] };
  };
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('DELETE FROM carros')) {
        return deletionAllowed ? { rowCount: 1, rows: [{ numero: params[0] }] } : { rowCount: 0, rows: [] };
      }
      return {
        rowCount: 1,
        rows: [{ existe: carExists, tiene_notebooks: hasNotebooks }]
      };
    }
  });
  try {
    const updated = await apiService.updateCarro(
      { numero: '23', ubicacion: 'teoria_p1' }, { id: 1, rol: 'admin' }, { numero: '2' }
    );
    assert.deepEqual(updated.carro, { numero: 23, ubicacion: 'teoria_p1' });
    assert.match(calls[0].sql, /UPDATE carros SET numero = \$2, ubicacion = \$3/);
    await assert.rejects(
      apiService.updateCarro({ ubicacion: 'auditorio' }, { id: 1, rol: 'admin' }, { numero: '23' }),
      (error) => error.status === 400
    );
    duplicate = true;
    await assert.rejects(
      apiService.updateCarro({ numero: 23 }, { id: 1, rol: 'admin' }, { numero: '2' }),
      (error) => error.status === 409
    );
    duplicate = false;
    await assert.rejects(
      apiService.deleteCarro({}, { id: 1, rol: 'admin' }, { numero: '23' }),
      (error) => error.status === 409 && /tiene notebooks/.test(error.message)
    );
    hasNotebooks = false;
    carExists = false;
    await assert.rejects(
      apiService.deleteCarro({}, { id: 1, rol: 'admin' }, { numero: '23' }),
      (error) => error.status === 404
    );
    carExists = true;
    deletionAllowed = true;
    assert.deepEqual(
      await apiService.deleteCarro({}, { id: 1, rol: 'admin' }, { numero: '23' }),
      { message: 'Carro eliminado' }
    );
    await assert.rejects(
      apiService.updateCarro({ ubicacion: 'taller' }, { id: 1, rol: 'alumno' }, { numero: '23' }),
      (error) => error.status === 403
    );
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('admin puede mover una notebook a un carro existente y rechaza destinos inválidos', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, estado, carro_id FROM notebooks')) {
        return { rowCount: 1, rows: [{ id: '44', estado: 'disponible', carro_id: 1 }] };
      }
      if (sql.includes('SELECT numero FROM carros WHERE numero = $1 FOR SHARE')) {
        return { rowCount: params[0] === 2 ? 1 : 0, rows: [{ numero: 2 }] };
      }
      if (sql.includes('UPDATE notebooks SET')) {
        return { rowCount: 1, rows: [{ id: 'NB-044', estado: 'disponible', ubicacion: 'Carro 2', carro_id: 2 }] };
      }
      return { rowCount: 1, rows: [] };
    }
  });
  try {
    const moved = await apiService.updateNotebook({ carro: 2 }, { id: 1, rol: 'admin' }, { code: 'NB-044' });
    assert.equal(moved.notebook.carro_id, 2);
    assert.match(calls.find(call=>call.sql.includes('UPDATE notebooks SET')).sql, /carro_id = CASE/);
    await assert.rejects(
      apiService.updateNotebook({ carro: 1000 }, { id: 1, rol: 'admin' }, { code: 'NB-044' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.updateNotebook({ carro: 9 }, { id: 1, rol: 'admin' }, { code: 'NB-044' }),
      (error) => error.status === 400 && /carro de destino no existe/.test(error.message)
    );
  } finally {
    db.transaction = originalTransaction;
  }
});

test('los tickets cambian notebooks solo en estados permitidos y preservan otros tickets activos', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  let notebookState = 'disponible';
  let hasOtherActiveTicket = false;
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('UPDATE tickets SET estado')) {
        return { rowCount: 1, rows: [{ id: 'TCK-1', estado: params[0], notebook_id: 4 }] };
      }
      if (sql.includes("SET estado = 'mantenimiento'")) {
        if (notebookState === 'disponible') notebookState = 'mantenimiento';
      }
      if (sql.includes("SET estado = 'disponible'") && sql.includes('NOT EXISTS')) {
        if (notebookState === 'mantenimiento' && !hasOtherActiveTicket) notebookState = 'disponible';
      }
      return { rowCount: 1, rows: [] };
    }
  });
  try {
    await assert.rejects(
      apiService.updateTicket({ estado: 'incorrecto' }, { id: 1, rol: 'admin' }, { code: 'TCK-1' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.updateTicket({ estado: 'resuelto' }, { id: 2, rol: 'alumno' }, { code: 'TCK-1' }),
      (error) => error.status === 403
    );
    const progressed = await apiService.updateTicket({ estado: 'progreso' }, { id: 1, rol: 'admin' }, { code: 'TCK-1' });
    assert.equal(progressed.ticket.estado, 'progreso');
    assert.equal(notebookState, 'mantenimiento');
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /estado = \$1::ticket_status/);
    assert.match(calls[0].sql, /resolved_at = CASE WHEN \$2::text = 'resuelto' THEN now\(\)/);
    assert.match(calls[0].sql, /resolved_by = CASE WHEN \$2::text = 'resuelto' THEN \$3::bigint ELSE NULL END/);
    assert.deepEqual(calls[0].params, ['progreso', 'progreso', 1, 'TCK-1']);
    assert.match(calls[1].sql, /SET estado = 'mantenimiento'/);
    assert.match(calls[1].sql, /WHERE id = \$1::bigint AND estado = 'disponible'/);

    calls.length = 0;
    hasOtherActiveTicket = true;
    const result = await apiService.updateTicket({ estado: 'resuelto' }, { id: 1, rol: 'admin' }, { code: 'TCK-1' });
    assert.equal(result.ticket.estado, 'resuelto');
    assert.equal(notebookState, 'mantenimiento');
    assert.equal(calls.length, 2);
    assert.match(calls[1].sql, /NOT EXISTS \(SELECT 1 FROM tickets/);
    assert.match(calls[1].sql, /estado IN \('abierto', 'progreso'\)/);

    calls.length = 0;
    hasOtherActiveTicket = false;
    const available = await apiService.updateTicket({ estado: 'resuelto' }, { id: 1, rol: 'admin' }, { code: 'TCK-1' });
    assert.equal(available.ticket.estado, 'resuelto');
    assert.equal(notebookState, 'disponible');
    assert.equal(calls.length, 2);

    calls.length = 0;
    notebookState = 'mantenimiento';
    const reopened = await apiService.updateTicket({ estado: 'abierto' }, { id: 1, rol: 'admin' }, { code: 'TCK-1' });
    assert.equal(reopened.ticket.estado, 'abierto');
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /resolved_at = CASE WHEN \$2::text = 'resuelto' THEN now\(\) ELSE NULL END/);
    assert.deepEqual(calls[0].params, ['abierto', 'abierto', 1, 'TCK-1']);
    assert.equal(notebookState, 'mantenimiento');
  } finally {
    db.transaction = originalTransaction;
  }
});

test('la devolución registra hora del servidor e ignora la hora recibida del cliente', async () => {
  const originalTransaction = db.transaction;
  const statements = [];
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      statements.push({ sql: sql.replace(/\s+/g, ' '), params });
      if (sql.includes("UPDATE loans SET estado = 'devolucion_pendiente'")) {
        return { rowCount: 1, rows: [{ id: '80', notebook_id: '11' }] };
      }
      if (sql.includes('INSERT INTO returns')) return { rowCount: 1, rows: [] };
      if (sql.includes("UPDATE notebooks SET estado = 'pendiente_devolucion'")) return { rowCount: 1, rows: [] };
      throw new Error(`Consulta no prevista: ${sql}`);
    }
  });
  try {
    assert.deepEqual(await apiService.requestReturn({}, { id: 7 }, { id: '80' }), {
      message: 'Devolución pendiente de confirmación'
    });
    assert.deepEqual(await apiService.requestReturn({ horaPrevista: '01:02' }, { id: 7 }, { id: '80' }), {
      message: 'Devolución pendiente de confirmación'
    });
    const inserts = statements.filter(({ sql }) => sql.includes('INSERT INTO returns'));
    assert.equal(inserts.length, 2);
    for (const insert of inserts) {
      assert.match(insert.sql, /now\(\) AT TIME ZONE 'America\/Argentina\/Buenos_Aires'/);
      assert.deepEqual(insert.params, ['80']);
    }
  } finally {
    db.transaction = originalTransaction;
  }
});

test('el cambio de estado de notebook separa el enum del parámetro comparado como texto', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, estado, carro_id FROM notebooks')) {
        return { rowCount: 1, rows: [{ id: 7, estado: 'disponible', carro_id: 1 }] };
      }
      if (sql.includes('UPDATE notebooks SET')) {
        return { rowCount: 1, rows: [{ id: 'NB-1', estado: params[0], ubicacion: 'Taller' }] };
      }
      return { rowCount: 0, rows: [] };
    }
  });
  try {
    await apiService.updateNotebook({ estado: 'mantenimiento' }, { id: 1, rol: 'admin' }, { code: 'NB-1' });
    const update = calls.find(({ sql }) => sql.includes('UPDATE notebooks SET'));
    assert.match(update.sql, /estado = CASE WHEN \$1::text IS NULL THEN estado ELSE \$1::notebook_status END/);
    assert.match(update.sql, /WHEN \$1::text = 'mantenimiento' THEN 'Taller'/);
    assert.deepEqual(update.params, ['mantenimiento', null, 7]);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('el inventario proyecta como reservada solo una notebook disponible', async () => {
  const originalQuery = db.query;
  let queryText = '';
  db.query = async (sql) => {
    queryText = sql;
    return { rowCount: 0, rows: [] };
  };
  try {
    await apiService.notebooks();
    assert.match(queryText, /CASE WHEN n\.estado = 'disponible'\s+AND EXISTS/);
    assert.equal((queryText.match(/n\.estado = 'disponible'/g) || []).length, 2);
  } finally {
    db.query = originalQuery;
  }
});

test('la migración de resolución de tickets es incremental y conserva tickets existentes', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database', 'migrations', '007-ticket-resolution-metadata.sql'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'backend', 'scripts', 'db.js'), 'utf8');

  assert.match(migration, /ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS resolved_by BIGINT REFERENCES users\(id\)/i);
  assert.doesNotMatch(migration, /\bUPDATE\s+tickets\b/i);
  assert.match(runner, /'007-ticket-resolution-metadata\.sql'/);
});

test('la migración de hora prevista es incremental y nullable', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database', 'migrations', '008-return-scheduled-time.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'backend', 'scripts', 'db.js'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS hora_prevista TIME/i);
  assert.doesNotMatch(migration, /NOT NULL/i);
  assert.doesNotMatch(migration, /UPDATE\s+loans/i);
  assert.match(schema, /hora_prevista TIME,/);
  assert.match(runner, /'008-return-scheduled-time\.sql'/);
});

test('la migración de hora de devolución de reservas es incremental y nullable', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database', 'migrations', '009-reservation-return-time.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'backend', 'scripts', 'db.js'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS hora_devolucion TIME/i);
  assert.doesNotMatch(migration, /NOT NULL/i);
  assert.match(schema, /hora_devolucion TIME,/);
  assert.match(runner, /'009-reservation-return-time\.sql'/);
});

test('la migración DNI y carros preserva datos, agrega CHECK e índices y refleja el esquema', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(path.join(root, 'database', 'migrations', '010-dni-carros-y-sesiones.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'backend', 'scripts', 'db.js'), 'utf8');
  assert.match(migration, /ALTER TABLE users RENAME COLUMN legajo TO dni/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS ubicacion VARCHAR\(20\)/i);
  assert.match(migration, /teoria_pb.*teoria_p1.*teoria_p2/s);
  assert.match(migration, /ON UPDATE CASCADE/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS notebooks_carro_estado_idx/i);
  assert.match(schema, /dni VARCHAR\(32\) NOT NULL UNIQUE/);
  assert.match(schema, /ON UPDATE CASCADE/);
  assert.match(runner, /'010-dni-carros-y-sesiones\.sql'/);
});

test('la interfaz muestra selector reabrible, contador de texto, carro y curso estructurado', () => {
  const root = path.resolve(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'backend', 'services', 'api-service.js'), 'utf8');
  assert.match(html, /id="resCarro"/);
  assert.match(html, /id="resUbicacion"/);
  assert.match(html, /id="userDni"[^>]+inputmode="numeric"[^>]+pattern="\[0-9\]\{7,8\}"/);
  assert.match(html, /Mantener sesión iniciada/);
  assert.match(html, /data-roles-el="alumno,profesor" onclick="switchView\('tickets'\)"/);
  assert.match(html, /<div class="card" data-roles-el="alumno,profesor">[\s\S]*?Notificaciones por email/);
  assert.match(app, /localStorage/);
  assert.match(app, /sessionStorage/);
  assert.match(app, /const storage = persistent \? window\.localStorage : window\.sessionStorage/);
  assert.match(app, /window\.localStorage\.removeItem\('netmo_token'\)/);
  assert.match(app, /window\.sessionStorage\.removeItem\('netmo_token'\)/);
  assert.match(app, /apiRequest\('\/api\/me'\)/);
  assert.match(app, /expiresAt - Date\.now\(\)\/1000 >= 2\*60\*60/);
  assert.match(app, /api\/auth\/refresh/);
  assert.match(app, /fetch\(API_BASE\+'\/health', \{signal:controller\.signal\}\)/);
  assert.match(app, /Ingresando\.\.\./);
  assert.match(app, /\/api\/admin\/carros\/\$\{numero\}/);
  assert.match(app, /\/api\/notebooks\/\$\{encodeURIComponent\(codigo\)\}/);
  assert.match(html, /id="roleAdminPassword" type="password"/);
  assert.match(app, /solicitarPasswordAdministrador/);
  assert.match(api, /No podés cambiar tu propio rol/);
  assert.match(api, /Confirmá tu contraseña para ascender/);
  assert.match(html, /id="resCantidad" min="1" max="2"/);
  assert.match(html, /id="loteCantidad" min="3" max="10"/);
  assert.match(html, /id="returnModalText"/);
  assert.match(html, /La hora actual de Buenos Aires se registra automáticamente/);
  assert.doesNotMatch(html, /id="returnHour"/);
  const returnAction = app.slice(app.indexOf('async function confirmarDevolucion'), app.indexOf('/* ======================================================================', app.indexOf('async function confirmarDevolucion')));
  assert.match(returnAction, /method:'POST'/);
  assert.doesNotMatch(returnAction, /horaPrevista/);
  assert.match(html, /id="resHoraDevolucion" min="08:01" max="17:30"/);
  assert.match(html, /id="adminFilterEstado" onchange="filterAdminNotebooks\(\)"/);
  assert.match(html, /option value="pendiente_devolucion"/);
  assert.match(html, /option value="reservada"/);
  assert.match(html, /type="number" id="resCursoAnio"/);
  assert.match(html, /type="number" id="resCursoDivision"/);
  assert.match(html, /id="fallaDesc" maxlength="50"/);
  assert.match(html, /id="userNombre" type="text" maxlength="50"/);
  assert.match(app, /renderAdminStateSelect\(`Cambiar estado de \$\{escapeHtml\(nb\.id\)\}/);
  assert.match(app, /renderAdminStateSelect\(`Cambiar estado del ticket \$\{escapeHtml\(t\.id\)\}/);
  assert.match(app, /function adminChangeState\(select\)/);
  assert.match(app, /function filterAdminNotebooks\(\)/);
  assert.match(app, /nb\.estado===est/);
  assert.match(app, /horaPrevista/);
  assert.match(app, /validarHoraDevolucionReserva\(hora, horaDevolucion\)/);
  assert.match(app, /horaDevolucion, motivo/);
  assert.match(app, /Hora acordada \$\{escapeHtml\(n\.horaDevolucion/);
  assert.match(html, /La hora actual de Buenos Aires se registra automáticamente/);
  assert.doesNotMatch(html, /id="returnHour"/);
  assert.match(html, /id="prestamosNoEntregadosTable"/);
  assert.match(app, /apiRequest\('\/api\/admin\/open-loans'\)/);
  assert.match(app, /loan\.estado==='devolucion_pendiente' && loan\.returnId/);
  assert.match(app, /confirmarRecepcionPrestamo/);
  assert.match(app, /const canApprove = r\.estado==='pendiente_aprobacion'/);
  assert.match(app, /const canReject = \['pendiente_aprobacion','aprobada'\]\.includes\(r\.estado\)/);
  assert.match(app, /function aprobarSolicitud\(id\)/);
  assert.match(app, /function pedirRechazoSolicitud\(id\)/);
  assert.doesNotMatch(app, /function aprobarLote\(id\)/);
  assert.doesNotMatch(app, /function pedirRechazoLote\(id\)/);
  assert.match(app, /const adminReservations = reservas\.filter\(r=>!\['cancelada','retirada'\]\.includes\(r\.estado\)\)/);
  assert.match(app, /const priority = \{confirmada:0, aprobada:0, pendiente_aprobacion:1, rechazada:2\}/);
  assert.match(app, /\(priority\[a\.estado\] \?\? 2\) - \(priority\[b\.estado\] \?\? 2\) \|\| b\.fecha\.localeCompare\(a\.fecha\)/);
  assert.match(app, /let reservationSubmitting = false/);
  assert.match(app, /void cargarCarrosReserva\(\)/);
  assert.match(app, /No se pudieron cargar los carros/);
  assert.match(app, /resCarroRetry/);
  assert.match(app, /refreshOwnTickets\(\)/);
  assert.match(app, /initializeTextLimits\(\)/);
  assert.doesNotMatch(app, /adminSetTicketEstado/);
});
