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
const { parseBusinessDateTime, reservationTimeError, TIME_ZONE } = require('../services/business-time');
const { accountEmail, accountPassword, courseDivision, personName, requiredText } = require('../services/validation');

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
    legajo: '990099',
    nombre: 'Usuario Prueba',
    email: 'login-regression@example.test',
    rol: 'alumno',
    baneado: false
  };
  let savedPassword;
  let loginQuery;
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
    if (sql.includes('SELECT id, legajo, nombre, email, rol')) {
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
      legajo: createdUser.legajo,
      rol: 'alumno',
      password
    }, { id: '1', rol: 'admin' });
    assert.equal(savedPassword, password);

    const accepted = await authService.login(
      { email: 'LOGIN-REGRESSION@EXAMPLE.TEST', password },
      request
    );
    assert.equal(accepted.user.id, createdUser.id);
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
    ['POST', '/api/admin/notebooks'],
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
        return { rows: [{ id: '5', legajo: '123', nombre: 'Ana Pérez', email: 'user@example.test', rol: 'alumno' }] };
      }
      return { rowCount: 1 };
    }
  });
  try {
    await assert.rejects(
      apiService.createUser({ nombre: 'A ', apellido: 'Pérez', email: 'short@example.test', legajo: '123', rol: 'alumno', password: 'short' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    const result = await apiService.createUser({
      nombre: 'Ana', apellido: 'Pérez', email: 'USER@example.test', legajo: '123', rol: 'alumno', password: 'long-enough'
    }, { id: 1, rol: 'admin' });
    assert.equal(result.user.email, 'user@example.test');
    assert.equal(result.user.rol, 'alumno');
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /crypt\(\$5, gen_salt\('bf'\)\)/);
    assert.deepEqual(calls[0].params.slice(0, 4), ['123', 'Ana Pérez', 'user@example.test', 'alumno']);
    assert.match(calls[1].sql, /INSERT INTO user_preferences/);
    assert.deepEqual(calls[1].params, ['5']);
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'bad email@example.test', legajo: '123', rol: 'alumno', password: 'long-enough' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'ana@bad@domain.test', legajo: '123', rol: 'alumno', password: 'long-enough' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'ok@example.test', legajo: '123', rol: 'alumno', password: 'long pass' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 400
    );
    duplicateAccount = true;
    await assert.rejects(
      apiService.createUser({ nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.test', legajo: '123', rol: 'alumno', password: 'long-enough' }, { id: 1, rol: 'admin' }),
      (error) => error.status === 409
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
    return { rows: [{ numero: 2, disponibles: 4 }], rowCount: 1 };
  };
  try {
    const route = routes.resolve('GET', '/api/carros');
    assert.equal(route.action, 'availableCarros');
    assert.deepEqual(await apiService[route.action]({}, { id: 7, rol: 'alumno' }), {
      carros: [{ numero: 2, disponibles: 4 }]
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
      if (sql.includes('SELECT numero FROM carros WHERE numero =')) {
        return { rowCount: selectedCarroExists ? 1 : 0, rows: selectedCarroExists ? [{ numero: params[0] }] : [] };
      }
      if (sql.includes('SELECT n.id FROM notebooks n')) {
        return { rowCount: availableCount, rows: Array.from({ length: availableCount }, (_value, index) => ({ id: index + 1 })) };
      }
      if (sql.includes('INSERT INTO reservations')) {
        insertedReservations += 1;
        return { rowCount: 1, rows: [{ id: insertedReservations, estado: params[8] }] };
      }
      return { rowCount: 1, rows: [] };
    }
  });
  const now = new Date();
  const retiroAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  retiroAt.setUTCHours(14, 0, 0, 0);
  const request = (tipo, cantidad) => ({
    tipo, cantidad, carro: '2', curso: tipo === 'lote' ? '6°14°' : undefined,
    retiroAt: retiroAt.toISOString(), motivo: 'Trabajo'
  });
  try {
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
    for (const [user, tipo, cantidad] of [
      [{ id: 1, rol: 'alumno' }, 'individual', 1],
      [{ id: 2, rol: 'profesor' }, 'lote', 3]
    ]) {
      availableCount = cantidad - 1;
      await assert.rejects(
        apiService.createReservation(request(tipo, cantidad), user),
        (error) => error.status === 409 && /carro seleccionado/.test(error.message)
      );
    }
    assert.equal(insertedReservations, 0);
    availableCount = 1;
    await apiService.createReservation(request('individual', 1), { id: 1, rol: 'alumno' });
    availableCount = 3;
    await apiService.createReservation(request('lote', 3), { id: 2, rol: 'profesor' });
    assert.equal(insertedReservations, 2);
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
      return { rowCount: 1, rows: [{ legajo: '123', nombre: 'Ana Pérez', baneado: true, baneado_hasta: null }] };
    }
    if (sql.includes('SELECT id, legajo, nombre, email, rol')) {
      return { rowCount: 1, rows: [{ id: '5', legajo: '123', nombre: 'Ana Pérez', email: 'ana@example.test', rol: 'alumno', baneado: false }] };
    }
    return { rowCount: 1, rows: [] };
  };
  loginRateLimiter.reset();
  try {
    await assert.rejects(
      apiService.updateUser({ baneado: true, duracionDias: 2 }, { id: 1, rol: 'admin' }, { legajo: '123' }),
      (error) => error.status === 400
    );
    await apiService.updateUser({ baneado: true, duracionDias: 3 }, { id: 1, rol: 'admin' }, { legajo: '123' });
    assert.deepEqual(queries[0].params, [true, '123', 3]);
    assert.match(queries[0].sql, /now\(\) \+ \(\$3::text \|\| ' days'\)::interval/);

    const result = await authService.login(
      { email: 'ANA@example.test', password: 'existing-pass' },
      { headers: {}, socket: { remoteAddress: '192.0.2.30' } }
    );
    assert.equal(result.user.baneado, false);
    assert.match(queries[1].sql, /baneado_hasta <= now\(\)/);
    assert.match(queries[2].sql, /baneado_hasta > now\(\)/);
    assert.equal(queries[2].params[0], 'ana@example.test');
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

test('resolver tickets libera notebooks en una transacción y rechaza estados inválidos', async () => {
  const originalTransaction = db.transaction;
  const calls = [];
  db.transaction = async (callback) => callback({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('UPDATE tickets SET estado')) {
        return { rowCount: 1, rows: [{ id: 'TCK-1', estado: params[0], notebook_id: 4 }] };
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
    const result = await apiService.updateTicket({ estado: 'resuelto' }, { id: 1, rol: 'admin' }, { code: 'TCK-1' });
    assert.equal(result.ticket.estado, 'resuelto');
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /resolved_at = CASE WHEN \$1 = 'resuelto' THEN now\(\)/);
    assert.match(calls[0].sql, /resolved_by = CASE WHEN \$1 = 'resuelto' THEN \$2 ELSE NULL END/);
    assert.match(calls[1].sql, /SET estado = 'disponible'/);
    calls.length = 0;
    const reopened = await apiService.updateTicket({ estado: 'abierto' }, { id: 1, rol: 'admin' }, { code: 'TCK-1' });
    assert.equal(reopened.ticket.estado, 'abierto');
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /resolved_at = CASE WHEN \$1 = 'resuelto' THEN now\(\) ELSE NULL END/);
    assert.deepEqual(calls[0].params, ['abierto', 1, 'TCK-1']);
  } finally {
    db.transaction = originalTransaction;
  }
});

test('la interfaz muestra selector reabrible, contador de texto, carro y curso estructurado', () => {
  const root = path.resolve(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'frontend', 'app.js'), 'utf8');
  assert.match(html, /id="resCarro"/);
  assert.match(html, /type="number" id="resCursoAnio"/);
  assert.match(html, /type="number" id="resCursoDivision"/);
  assert.match(html, /id="fallaDesc" maxlength="50"/);
  assert.match(html, /id="userNombre" type="text" maxlength="50"/);
  assert.match(app, /renderAdminStateSelect\(`Cambiar estado de \$\{escapeHtml\(nb\.id\)\}/);
  assert.match(app, /renderAdminStateSelect\(`Cambiar estado del ticket \$\{escapeHtml\(t\.id\)\}/);
  assert.match(app, /function adminChangeState\(select\)/);
  assert.match(app, /void cargarCarrosReserva\(\)/);
  assert.match(app, /No se pudieron cargar los carros/);
  assert.match(app, /resCarroRetry/);
  assert.match(app, /refreshOwnTickets\(\)/);
  assert.match(app, /initializeTextLimits\(\)/);
  assert.doesNotMatch(app, /adminSetTicketEstado/);
});
