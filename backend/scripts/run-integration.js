const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { testDatabaseError } = require('./database-safety');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '..');
const testUrl = process.env.TEST_DATABASE_URL;
const fakeJwtSecret = 'integration-only-secret-that-is-never-reused';
let pool;
let api;
let mailSink;
let baseUrl;
const deliveredCodes = new Map();

function poolOptions() {
  const hostname = new URL(testUrl).hostname;
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  return {
    connectionString: testUrl,
    ssl: local ? false : { rejectUnauthorized: false }
  };
}

function assertSafeDatabase() {
  const error = testDatabaseError();
  if (error) throw new Error(`No se ejecutó ninguna prueba de integración: ${error}`);
}

function report(name, action) {
  return Promise.resolve().then(action).then((value) => {
    console.log(`OK ${name}`);
    return value;
  }, (error) => {
    console.error(`FALLA ${name}`);
    throw error;
  });
}

function runMigrations() {
  const result = spawnSync(process.execPath, [path.join(backend, 'scripts', 'db.js'), 'migrate'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      JWT_SECRET: fakeJwtSecret
    },
    encoding: 'utf8',
    timeout: 60_000
  });
  if (result.status !== 0) throw new Error('No se pudieron aplicar las migraciones en la base de test.');
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startMailSink() {
  mailSink = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const code = payload.html.match(/(?:^|\D)(\d{6})(?:\D|$)/)?.[1];
        if (code) deliveredCodes.set(payload.to, code);
      } catch {
        response.writeHead(400).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    });
  });
  await new Promise((resolve, reject) => {
    mailSink.once('error', reject);
    mailSink.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${mailSink.address().port}/mail`;
}

async function startApi(port, mailUrl) {
  api = spawn(process.execPath, [path.join(backend, 'server.js')], {
    cwd: backend,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: testUrl,
      JWT_SECRET: fakeJwtSecret,
      CORS_ORIGIN: 'http://localhost',
      MAIL_PROVIDER: 'gas',
      MAIL_GAS_URL: mailUrl,
      MAIL_GAS_SECRET: 'integration-mail-secret',
      MAIL_FROM_EMAIL: 'test@netmo.invalid',
      MAIL_FROM_NAME: 'NetMO integration'
    },
    stdio: 'ignore'
  });
  baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (api.exitCode !== null) throw new Error('La API de test terminó durante el inicio.');
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('La API de test no estuvo disponible.');
}

async function stopApi() {
  if (!api || api.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      api.kill();
      resolve();
    }, 3000);
    api.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    api.kill('SIGTERM');
  });
}

async function stopMailSink() {
  if (!mailSink?.listening) return;
  await new Promise((resolve) => mailSink.close(resolve));
}

async function closePool() {
  if (pool) await pool.end();
}

async function request(method, pathname, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, payload, headers: response.headers };
}

async function insertUser(legajo, name, email, role, password = 'Integration-pass-2026') {
  const result = await pool.query(`INSERT INTO users (legajo, nombre, email, rol, password_hash)
    VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf'))) RETURNING id`,
  [legajo, name, email, role, password]);
  await pool.query('INSERT INTO user_preferences (user_id, email_notifications) VALUES ($1, TRUE)', [result.rows[0].id]);
  return { id: String(result.rows[0].id), legajo, nombre: name, email, rol: role, password };
}

async function prepareDatabase() {
  await pool.query(`TRUNCATE TABLE audit_log, password_resets, late_returns, returns, tickets,
    loans, reservation_notebooks, reservations, notebooks, user_preferences, carros, users
    RESTART IDENTITY CASCADE`);
  const users = {};
  users.admin = await insertUser('990001', 'Admin Test', 'admin-integration@netmo.invalid', 'admin');
  users.professor = await insertUser('990002', 'Profesor Test', 'professor-integration@netmo.invalid', 'profesor');
  users.student = await insertUser('990003', 'Alumno Test', 'student-integration@netmo.invalid', 'alumno');
  users.cancel = await insertUser('990004', 'Alumno Cancelación', 'cancel-integration@netmo.invalid', 'alumno');
  users.expiredBan = await insertUser('990005', 'Alumno Baneo Vencido', 'expired-ban@netmo.invalid', 'alumno');
  users.activeBan = await insertUser('990006', 'Alumno Baneado', 'active-ban@netmo.invalid', 'alumno');
  users.resetExpiry = await insertUser('990007', 'Reset Vencido', 'reset-expiry@netmo.invalid', 'alumno');
  users.resetUsed = await insertUser('990008', 'Reset Usado', 'reset-used@netmo.invalid', 'alumno');
  users.resetAttempts = await insertUser('990009', 'Reset Intentos', 'reset-attempts@netmo.invalid', 'alumno');
  await pool.query("UPDATE users SET baneado = TRUE, baneado_hasta = now() - interval '1 minute' WHERE id = $1", [users.expiredBan.id]);
  await pool.query("UPDATE users SET baneado = TRUE, baneado_hasta = now() + interval '1 hour' WHERE id = $1", [users.activeBan.id]);
  await pool.query('INSERT INTO carros (numero) VALUES (1)');
  for (let index = 1; index <= 8; index += 1) {
    await pool.query(`INSERT INTO notebooks (codigo, ubicacion, carro_id)
      VALUES ($1, 'Carro 1', 1)`, [`NB-${String(index).padStart(3, '0')}`]);
  }
  return users;
}

async function login(user, password = user.password) {
  const response = await request('POST', '/api/auth/login', { email: user.email, password });
  assert.equal(response.status, 200, 'login de usuario de prueba');
  assert.equal(typeof response.payload.token, 'string');
  return response.payload.token;
}

function nextBusinessTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const initial = Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day));
  for (let offset = 0; offset < 8; offset += 1) {
    const day = new Date(initial + offset * 86_400_000);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const date = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
    const candidate = new Date(`${date}T10:00:00-03:00`);
    if (candidate > now) return `${date}T10:00`;
  }
  throw new Error('No se encontró un horario hábil futuro.');
}

async function adminPermissions(admin, adminUserId, professor, student) {
  const { createToken, TOKEN_LIFETIME_SECONDS } = require('../services/session-token');
  const expired = createToken(adminUserId, fakeJwtSecret, Date.now() - (TOKEN_LIFETIME_SECONDS + 1) * 1000);
  const manipulated = `${admin[0] === 'a' ? 'b' : 'a'}${admin.slice(1)}`;
  const paths = [
    ['GET', '/api/admin/professors', undefined],
    ['GET', '/api/admin/users', undefined],
    ['POST', '/api/admin/users', {}],
    ['GET', '/api/admin/carros', undefined],
    ['POST', '/api/admin/carros', {}],
    ['POST', '/api/admin/notebooks', {}],
    ['GET', '/api/admin/reservations', undefined],
    ['POST', '/api/admin/reservations/999999/approve', {}],
    ['POST', '/api/admin/reservations/999999/reject', {}],
    ['POST', '/api/admin/reservations/999999/checkout', {}],
    ['GET', '/api/admin/returns', undefined],
    ['POST', '/api/admin/returns/999999/confirm', {}],
    ['GET', '/api/admin/tickets', undefined],
    ['GET', '/api/admin/late-returns', undefined],
    ['GET', '/api/admin/backup', undefined],
    ['POST', '/api/admin/restore', {}],
    ['PATCH', '/api/admin/users/999999', {}],
    ['PATCH', '/api/admin/users/999999/rol', {}]
  ];
  for (const [method, pathname, body] of paths) {
    assert.equal((await request(method, pathname, body)).status, 401, `${method} ${pathname} sin token`);
    assert.equal((await request(method, pathname, body, manipulated)).status, 401, `${method} ${pathname} token manipulado`);
    assert.equal((await request(method, pathname, body, expired)).status, 401, `${method} ${pathname} token vencido`);
    for (const [label, token] of [['profesor', professor], ['alumno', student]]) {
      assert.equal((await request(method, pathname, body, token)).status, 403, `${method} ${pathname} rol ${label}`);
    }
  }
  return paths;
}

async function userPermissions(admin, adminUserId, professor, student) {
  const { createToken, TOKEN_LIFETIME_SECONDS } = require('../services/session-token');
  const expired = createToken(adminUserId, fakeJwtSecret, Date.now() - (TOKEN_LIFETIME_SECONDS + 1) * 1000);
  const manipulated = `${student[0] === 'a' ? 'b' : 'a'}${student.slice(1)}`;
  const routes = [
    ['GET', '/api/me', undefined],
    ['GET', '/api/preferences', undefined],
    ['PATCH', '/api/preferences', { email: true, recordatorio: 30 }],
    ['GET', '/api/notebooks', undefined],
    ['PATCH', '/api/notebooks/NB-999', { estado: 'mantenimiento' }],
    ['GET', '/api/reservations', undefined],
    ['POST', '/api/reservations', {}],
    ['DELETE', '/api/reservations/RES-NONEXISTENT', undefined],
    ['GET', '/api/loans', undefined],
    ['POST', '/api/loans/999999/return', {}],
    ['GET', '/api/tickets', undefined],
    ['POST', '/api/tickets', {}],
    ['PATCH', '/api/tickets/TCK-NONEXISTENT', { estado: 'abierto' }],
    ['POST', '/api/auth/change-password/request', {}],
    ['POST', '/api/auth/change-password', { code: '000000', password: 'password-test' }]
  ];
  for (const [method, pathname, body] of routes) {
    assert.equal((await request(method, pathname, body)).status, 401, `${method} ${pathname} sin token`);
    assert.equal((await request(method, pathname, body, manipulated)).status, 401, `${method} ${pathname} token manipulado`);
    assert.equal((await request(method, pathname, body, expired)).status, 401, `${method} ${pathname} token vencido`);
    for (const token of [admin, professor, student]) {
      const response = await request(method, pathname, body, token);
      assert.notEqual(response.status, 401, `${method} ${pathname} token válido`);
      if (pathname === '/api/notebooks/NB-999' || pathname.startsWith('/api/tickets/')) {
        if (token !== admin) assert.equal(response.status, 403, `${method} ${pathname} solo admin`);
      }
    }
  }
}

async function assertBackupUnchanged(adminToken, backup, adminPassword) {
  const after = await request('GET', '/api/admin/backup', undefined, adminToken);
  assert.equal(after.status, 200, 'backup sigue disponible luego de un restore rechazado');
  assert.deepEqual(after.payload.data, backup.data, 'los datos deben seguir idénticos después del rollback');
  assert.equal(typeof adminPassword, 'string');
}

async function runFlows(users) {
  const tokens = {};
  for (const role of ['admin', 'professor', 'student']) {
    tokens[role] = await login(users[role]);
  }
  await report('autenticación admin, profesor y alumno', () => assert.ok(tokens.admin && tokens.professor && tokens.student));

  await report('autorización de todas las rutas admin y tokens inválidos', async () => {
    const paths = await adminPermissions(tokens.admin, users.admin.id, tokens.professor, tokens.student);
    for (const [method, pathname, body] of paths) {
      const valid = await request(method, pathname, body, tokens.admin);
      assert.notEqual(valid.status, 401, `${method} ${pathname} admin autenticado`);
      assert.notEqual(valid.status, 403, `${method} ${pathname} admin autorizado`);
    }
    await userPermissions(tokens.admin, users.admin.id, tokens.professor, tokens.student);
  });

  const reservationTime = nextBusinessTime();
  await report('validaciones de reserva: fechas pasadas, franja horaria y cantidad', async () => {
    for (const invalid of [
      { retiroAt: '2000-01-01T10:00', cantidad: 1 },
      { retiroAt: reservationTime.slice(0, 10) + 'T12:00', cantidad: 1 },
      { retiroAt: reservationTime, cantidad: 0 },
      { retiroAt: reservationTime, cantidad: 2 }
    ]) {
      const response = await request('POST', '/api/reservations', invalid, tokens.student);
      assert.equal(response.status, 400);
    }
    const studentLot = await request('POST', '/api/reservations', {
      tipo: 'lote', retiroAt: reservationTime, cantidad: 3, curso: 'Curso test'
    }, tokens.student);
    assert.equal(studentLot.status, 403);
  });

  const reservationResponse = await report('reserva individual y confirmación de correo', async () => {
    const result = await request('POST', '/api/reservations', {
      retiroAt: reservationTime, cantidad: 1, motivo: 'Prueba de integración'
    }, tokens.student);
    assert.equal(result.status, 201);
    assert.equal(result.payload.reservation.estado, 'confirmada');
    return result.payload.reservation;
  });

  const loanId = await report('retiro, préstamo, solicitud de devolución y confirmación', async () => {
    const checkout = await request('POST', `/api/admin/reservations/${reservationResponse.id}/checkout`, {}, tokens.admin);
    assert.equal(checkout.status, 200);
    assert.equal(checkout.payload.loansCreated, 1);
    let loans = await request('GET', '/api/loans', undefined, tokens.student);
    assert.equal(loans.status, 200);
    assert.equal(loans.payload.loans.length, 1);
    const id = loans.payload.loans[0].id;
    assert.equal((await request('POST', `/api/loans/${id}/return`, {}, tokens.student)).status, 202);
    const returns = await request('GET', '/api/admin/returns', undefined, tokens.admin);
    assert.equal(returns.status, 200);
    const returnRow = await pool.query("SELECT id FROM returns WHERE loan_id = $1", [id]);
    assert.equal(returnRow.rowCount, 1);
    assert.equal((await request('POST', `/api/admin/returns/${returnRow.rows[0].id}/confirm`, {}, tokens.admin)).status, 200);
    loans = await request('GET', '/api/loans', undefined, tokens.student);
    assert.equal(loans.payload.loans[0].estado, 'devuelto');
    assert.ok(loans.payload.loans[0].devuelta_at);
    return id;
  });

  await report('ticket, resolución y estado del inventario', async () => {
    const created = await request('POST', '/api/tickets', {
      notebook: 'NB-001', motivo: 'Prueba', descripcion: 'Incidencia temporal de integración'
    }, tokens.student);
    assert.equal(created.status, 201);
    const listed = await request('GET', '/api/tickets', undefined, tokens.student);
    assert.equal(listed.status, 200);
    assert.ok(listed.payload.tickets.some((ticket) => ticket.id === created.payload.ticket.id));
    const inventory = await request('GET', '/api/notebooks', undefined, tokens.admin);
    assert.equal(inventory.status, 200);
    assert.ok(inventory.payload.notebooks.some((notebook) => notebook.id === 'NB-001' && notebook.estado === 'mantenimiento'));
    assert.equal((await request('PATCH', `/api/tickets/${encodeURIComponent(created.payload.ticket.id)}`, { estado: 'resuelto' }, tokens.admin)).status, 200);
    const restored = await request('GET', '/api/notebooks', undefined, tokens.admin);
    assert.ok(restored.payload.notebooks.some((notebook) => notebook.id === 'NB-001' && notebook.estado === 'disponible'));
  });

  await report('lote profesor, aprobación y rechazo de lote', async () => {
    const lot = await request('POST', '/api/reservations', {
      tipo: 'lote', retiroAt: reservationTime, cantidad: 3, curso: 'Curso test'
    }, tokens.professor);
    assert.equal(lot.status, 201);
    assert.equal(lot.payload.reservation.estado, 'pendiente_aprobacion');
    assert.equal((await request('POST', `/api/admin/reservations/${lot.payload.reservation.id}/approve`, {}, tokens.admin)).status, 200);
    assert.equal((await request('POST', `/api/admin/reservations/${lot.payload.reservation.id}/reject`, {}, tokens.admin)).status, 200);
  });

  await report('cancelación de reserva', async () => {
    const created = await request('POST', '/api/reservations', {
      retiroAt: reservationTime, cantidad: 1
    }, tokens.cancel);
    assert.equal(created.status, 201);
    const code = created.payload.reservation.id_codigo;
    assert.equal((await request('DELETE', `/api/reservations/${encodeURIComponent(code)}`, undefined, await login(users.cancel))).status, 200);
  });

  await report('validaciones y alta administrativa de usuario', async () => {
    const rejected = await request('POST', '/api/admin/users', {
      nombre: 'Inválido', apellido: 'Test', email: 'invalid-user@netmo.invalid',
      legajo: '990010', rol: 'alumno', password: 'short'
    }, tokens.admin);
    assert.equal(rejected.status, 400);
    const created = await request('POST', '/api/admin/users', {
      nombre: 'Nuevo', apellido: 'Usuario', email: 'new-user@netmo.invalid',
      legajo: '990010', rol: 'alumno', password: 'new-user-pass-2026'
    }, tokens.admin);
    assert.equal(created.status, 201);
    await pool.query('UPDATE users SET email = upper(email) WHERE id = $1', [created.payload.user.id]);
    const successfulLogin = await request('POST', '/api/auth/login', {
      email: 'NEW-USER@NETMO.INVALID',
      password: 'Abcd1234'
    });
    assert.equal(successfulLogin.status, 200);
    const invalidLogin = await request('POST', '/api/auth/login', {
      email: 'new-user@netmo.invalid',
      password: 'incorrecta'
    });
    assert.equal(invalidLogin.status, 401);
    const duplicate = await request('POST', '/api/admin/users', {
      nombre: 'Otro', apellido: 'Usuario', email: 'new-user@netmo.invalid',
      legajo: '990011', rol: 'alumno', password: 'new-user-pass-2026'
    }, tokens.admin);
    assert.equal(duplicate.status, 409);
  });

  await report('login no aplica las reglas de formato de claves nuevas', async () => {
    const legacy = await insertUser(
      '990012',
      'Usuario Clave Histórica',
      'legacy-password@netmo.invalid',
      'alumno',
      ' x '
    );
    const response = await request('POST', '/api/auth/login', {
      email: legacy.email,
      password: legacy.password
    });
    assert.equal(response.status, 200);
  });

  await report('inventario: carros, notebooks y cambios de estado', async () => {
    assert.equal((await request('POST', '/api/admin/carros', { numero: 2 }, tokens.admin)).status, 201);
    assert.ok((await request('GET', '/api/admin/carros', undefined, tokens.admin)).payload.carros.some((item) => item.numero === 2));
    assert.equal((await request('POST', '/api/admin/notebooks', {
      numero: '020', carro_id: 2, cantidad: 2
    }, tokens.admin)).status, 201);
    assert.equal((await request('PATCH', '/api/notebooks/NB-020', { estado: 'mantenimiento' }, tokens.admin)).status, 200);
    assert.equal((await request('PATCH', '/api/notebooks/NB-020', { estado: 'disponible' }, tokens.admin)).status, 200);
  });

  await report('aplicar y quitar baneo administrativo', async () => {
    assert.equal((await request('PATCH', `/api/admin/users/${users.cancel.legajo}`, {
      baneado: true, duracionDias: 3
    }, tokens.admin)).status, 200);
    const blocked = await request('POST', '/api/auth/login', {
      email: users.cancel.email, password: users.cancel.password
    });
    assert.equal(blocked.status, 403);
    assert.equal((await request('PATCH', `/api/admin/users/${users.cancel.legajo}`, {
      baneado: false
    }, tokens.admin)).status, 200);
  });

  await report('baneos vencidos y activos durante el login', async () => {
    assert.equal(typeof await login(users.expiredBan), 'string');
    const denied = await request('POST', '/api/auth/login', {
      email: users.activeBan.email, password: users.activeBan.password
    });
    assert.equal(denied.status, 403);
  });

  const knownForgot = await request('POST', '/api/auth/forgot', { email: users.resetUsed.email });
  const unknownForgot = await request('POST', '/api/auth/forgot', { email: 'missing-reset@netmo.invalid' });
  await report('forgot responde igual para correo existente e inexistente', async () => {
    assert.equal(knownForgot.status, 200);
    assert.equal(unknownForgot.status, 200);
    assert.deepEqual(knownForgot.payload, unknownForgot.payload);
    const firstCode = deliveredCodes.get(users.resetUsed.email);
    assert.ok(firstCode);
    assert.equal((await request('POST', '/api/auth/forgot', { email: users.resetUsed.email })).status, 200);
    assert.equal(deliveredCodes.get(users.resetUsed.email), firstCode, 'cooldown evita emitir un segundo código');
  });

  await report('reset: vence, se usa una sola vez y limita a cinco intentos', async () => {
    const expiryCode = deliveredCodes.get(users.resetExpiry.email);
    assert.ok(expiryCode, 'el proveedor GAS de test recibió el código de vencimiento');
    await pool.query(`UPDATE password_resets SET expires_at = now() - interval '1 second'
      WHERE user_id = $1 AND purpose = 'reset'`, [users.resetExpiry.id]);
    const expired = await request('POST', '/api/auth/reset', {
      email: users.resetExpiry.email, code: expiryCode, password: 'new-pass-2026'
    });
    assert.equal(expired.status, 400);

    const usedCode = deliveredCodes.get(users.resetUsed.email);
    assert.ok(usedCode, 'el proveedor GAS de test recibió el código válido');
    const reset = await request('POST', '/api/auth/reset', {
      email: users.resetUsed.email, code: usedCode, password: 'new-pass-2026'
    });
    assert.equal(reset.status, 200);
    const reuse = await request('POST', '/api/auth/reset', {
      email: users.resetUsed.email, code: usedCode, password: 'new-pass-2026'
    });
    assert.equal(reuse.status, 400);

    await request('POST', '/api/auth/forgot', { email: users.resetAttempts.email });
    const wrongCode = deliveredCodes.get(users.resetAttempts.email) === '000000' ? '000001' : '000000';
    const invalidPassword = await request('POST', '/api/auth/reset', {
      email: users.resetAttempts.email, code: deliveredCodes.get(users.resetAttempts.email), password: 'bad password'
    });
    assert.equal(invalidPassword.status, 400);
    const attemptsBeforeWrongCode = await pool.query(
      "SELECT attempts FROM password_resets WHERE user_id = $1 AND purpose = 'reset'", [users.resetAttempts.id]
    );
    assert.equal(attemptsBeforeWrongCode.rows[0].attempts, 0);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request('POST', '/api/auth/reset', {
        email: users.resetAttempts.email, code: wrongCode, password: 'new-pass-2026'
      });
      assert.equal(failed.status, 400);
    }
    const exhausted = await request('POST', '/api/auth/reset', {
      email: users.resetAttempts.email, code: deliveredCodes.get(users.resetAttempts.email), password: 'new-pass-2026'
    });
    assert.equal(exhausted.status, 429);
  });

  await report('cambio de contraseña autenticado y nuevo login', async () => {
    assert.ok(deliveredCodes.has(users.student.email));
    assert.equal((await request('POST', '/api/auth/change-password/request', {}, tokens.student)).status, 429);
    const code = deliveredCodes.get(users.student.email);
    assert.ok(code, 'el proveedor GAS de test recibió el código de cambio');
    const changed = await request('POST', '/api/auth/change-password', {
      code, password: 'changed-pass-2026'
    }, tokens.student);
    assert.equal(changed.status, 200);
    assert.equal((await request('POST', '/api/auth/login', {
      email: users.student.email, password: 'changed-pass-2026'
    })).status, 200);
  });

  const originalBackupResponse = await report('backup con metadata y checksum', async () => {
    const response = await request('GET', '/api/admin/backup', undefined, tokens.admin);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-disposition'), /netmo-backup-\d{8}-\d{4}\.json/);
    assert.equal(response.payload.metadata.formato, 'netmo-backup');
    assert.ok(response.payload.checksum);
    return response.payload;
  });

  await report('restore recupera exactamente los datos y los rollbacks no los alteran', async () => {
    const source = await pool.query('SELECT nombre FROM users WHERE id = $1', [users.student.id]);
    await pool.query('UPDATE users SET nombre = $1 WHERE id = $2', ['Dato modificado', users.student.id]);
    const restored = await request('POST', '/api/admin/restore', {
      backup: originalBackupResponse, password: users.admin.password, confirmation: 'RESTAURAR'
    }, tokens.admin);
    assert.equal(restored.status, 200);
    const afterRestore = await request('GET', '/api/admin/backup', undefined, tokens.admin);
    assert.equal(afterRestore.status, 200);
    assert.deepEqual(afterRestore.payload.data, originalBackupResponse.data);
    assert.notEqual(source.rows[0].nombre, 'Dato modificado');

    const cases = [];
    const corruptChecksum = structuredClone(originalBackupResponse);
    corruptChecksum.checksum = '0'.repeat(64);
    cases.push(['checksum inválido', { backup: corruptChecksum, password: users.admin.password, confirmation: 'RESTAURAR' }, 400]);
    const noAdmin = structuredClone(originalBackupResponse);
    noAdmin.data.users = noAdmin.data.users.map((user) => ({ ...user, rol: user.rol === 'admin' ? 'alumno' : user.rol }));
    const backupService = require('../services/backup-service');
    const { checksum: _checksum, ...document } = noAdmin;
    noAdmin.checksum = backupService.checksumFor(document);
    cases.push(['backup sin admin', { backup: noAdmin, password: users.admin.password, confirmation: 'RESTAURAR' }, 400]);
    cases.push(['contraseña incorrecta', { backup: originalBackupResponse, password: 'wrong-password', confirmation: 'RESTAURAR' }, 403]);
    cases.push(['frase incorrecta', { backup: originalBackupResponse, password: users.admin.password, confirmation: 'RESTAURAR ' }, 400]);
    const invalidType = structuredClone(originalBackupResponse);
    invalidType.data.users[0].baneado = 'no';
    const { checksum: _oldChecksum, ...invalidDocument } = invalidType;
    invalidType.checksum = backupService.checksumFor(invalidDocument);
    cases.push(['tipo de dato inválido', { backup: invalidType, password: users.admin.password, confirmation: 'RESTAURAR' }, 400]);
    const invalidReference = structuredClone(originalBackupResponse);
    invalidReference.data.reservations.push({
      id: '999991', codigo: 'RES-INVALID-REFERENCE', owner_id: '999999',
      tipo: 'individual', cantidad: 1, retiro_at: new Date().toISOString(), estado: 'confirmada'
    });
    invalidReference.metadata.conteos.reservations += 1;
    const { checksum: _referenceChecksum, ...referenceDocument } = invalidReference;
    invalidReference.checksum = backupService.checksumFor(referenceDocument);
    cases.push(['referencia inconsistente', { backup: invalidReference, password: users.admin.password, confirmation: 'RESTAURAR' }, 400]);
    const constraintFailure = structuredClone(originalBackupResponse);
    const availableNotebook = constraintFailure.data.notebooks.find((notebook) => notebook.estado === 'disponible');
    availableNotebook.estado = 'prestada';
    availableNotebook.prestado_a = null;
    const { checksum: _constraintChecksum, ...constraintDocument } = constraintFailure;
    constraintFailure.checksum = backupService.checksumFor(constraintDocument);
    cases.push(['error transaccional con rollback', { backup: constraintFailure, password: users.admin.password, confirmation: 'RESTAURAR' }, 400]);
    for (const [label, body, expectedStatus] of cases) {
      const response = await request('POST', '/api/admin/restore', body, tokens.admin);
      assert.equal(response.status, expectedStatus, label);
      await assertBackupUnchanged(tokens.admin, originalBackupResponse, users.admin.password);
    }
  });
}

async function main() {
  assertSafeDatabase();
  runMigrations();
  const { Pool } = require('pg');
  pool = new Pool(poolOptions());
  try {
    const users = await report('preparación exclusiva de base de test', prepareDatabase);
    const mailUrl = await startMailSink();
    await startApi(await unusedPort(), mailUrl);
    await report('API de test disponible y frontend servido', async () => {
      assert.equal((await fetch(`${baseUrl}/`)).status, 200);
      assert.equal((await fetch(`${baseUrl}/app.js`)).status, 200);
    });
    await runFlows(users);
  } finally {
    await stopApi();
    await stopMailSink();
    await closePool();
  }
}

main().catch(async (error) => {
  console.error(`FALLA integración: ${error.message}`);
  await stopApi().catch(() => {});
  await stopMailSink().catch(() => {});
  await closePool().catch(() => {});
  process.exitCode = 1;
});
