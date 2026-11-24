const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { testDatabaseError } = require('./database-safety');
const { businessTimeParts, loanDueAt } = require('../services/business-time');

const backend = path.resolve(__dirname, '..');
const root = path.resolve(backend, '..');
const testUrl = process.env.TEST_DATABASE_URL;
const fakeJwtSecret = 'integration-only-secret-that-is-never-reused';
const fakeCronSecret = 'integration-only-cron-secret';
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
      CRON_SECRET: fakeCronSecret,
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

async function request(method, pathname, body, token, additionalHeaders = {}) {
  const headers = { ...additionalHeaders };
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

async function insertUser(dni, name, email, role, password = 'Integration-pass-2026') {
  const result = await pool.query(`INSERT INTO users (dni, nombre, email, rol, password_hash)
    VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf'))) RETURNING id`,
  [dni, name, email, role, password]);
  await pool.query('INSERT INTO user_preferences (user_id, email_notifications) VALUES ($1, TRUE)', [result.rows[0].id]);
  return { id: String(result.rows[0].id), dni, nombre: name, email, rol: role, password };
}

async function prepareDatabase() {
  await pool.query(`TRUNCATE TABLE audit_log, password_resets, late_returns, returns, tickets,
    loans, reservation_notebooks, reservations, notebooks, user_preferences, carros, ubicaciones, users
    RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO ubicaciones (slug, nombre) VALUES
    ('taller', 'Taller'),
    ('teoria_pb', 'Teoría – Planta baja'),
    ('teoria_p1', 'Teoría – 1.er piso'),
    ('teoria_p2', 'Teoría – 2.º piso')`);
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
  users.lateBlock = await insertUser('990010', 'Alumno Bloqueo Automático', 'late-block@netmo.invalid', 'alumno');
  await pool.query("UPDATE users SET baneado = TRUE, baneado_hasta = now() - interval '1 minute' WHERE id = $1", [users.expiredBan.id]);
  await pool.query("UPDATE users SET baneado = TRUE, baneado_hasta = now() + interval '1 hour' WHERE id = $1", [users.activeBan.id]);
  const carro = await pool.query('INSERT INTO carros (numero) VALUES (1) RETURNING id');
  for (let index = 1; index <= 8; index += 1) {
    await pool.query(`INSERT INTO notebooks (codigo, ubicacion, carro_id)
      VALUES ($1, 'Carro 1', $2)`, [`NB-${String(index).padStart(3, '0')}`, carro.rows[0].id]);
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
    ['GET', '/api/admin/open-loans', undefined],
    ['GET', '/api/admin/loans', undefined],
    ['POST', '/api/admin/loans/999999/return', {}],
    ['POST', '/api/admin/loans/return', { loanIds: [1, 2] }],
    ['PATCH', '/api/admin/ubicaciones/ubicacion-inexistente', { nombre: 'Prueba' }],
    ['POST', '/api/admin/reminders/run', {}],
    ['POST', '/api/admin/returns/999999/confirm', {}],
    ['GET', '/api/admin/tickets', undefined],
    ['GET', '/api/admin/late-returns', undefined],
    ['GET', '/api/admin/backup', undefined],
    ['POST', '/api/admin/restore', {}],
    ['PATCH', '/api/admin/users/999999', {}],
    ['DELETE', '/api/admin/users/999999', undefined],
    ['POST', '/api/admin/users/999999/approve', {}],
    ['POST', '/api/admin/users/999999/reject', {}],
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
  tokens.cancel = await login(users.cancel);
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
      { retiroAt: '2000-01-01T10:00', horaDevolucion: '17:30', cantidad: 1 },
      { retiroAt: reservationTime.slice(0, 10) + 'T12:00', horaDevolucion: '17:30', cantidad: 1 },
      { retiroAt: reservationTime, horaDevolucion: '17:31', cantidad: 1 },
      { retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 0 },
      { retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 2 },
      { tipo: 'individual', retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 3, curso: '6°14°' }
    ]) {
      const response = await request('POST', '/api/reservations', invalid, tokens.student);
      assert.equal(response.status, 400);
    }
    const missingReturnHour = await request('POST', '/api/reservations', {
      retiroAt: reservationTime, cantidad: 1
    }, tokens.student);
    assert.equal(missingReturnHour.status, 400);
    assert.match(missingReturnHour.payload.error, /hora de devolución/);
    const missingCourse = await request('POST', '/api/reservations', {
      retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 1
    }, tokens.student);
    assert.equal(missingCourse.status, 400);
    assert.match(missingCourse.payload.error, /curso/i);
    const studentLot = await request('POST', '/api/reservations', {
      tipo: 'lote', retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 1, curso: 'Curso test'
    }, tokens.student);
    assert.equal(studentLot.status, 403);
  });

  const reservationResponse = await report('reserva individual pendiente de aprobación', async () => {
    const result = await request('POST', '/api/reservations', {
      retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 1, curso: '6°14°', carro: '1', motivo: 'Prueba de integración'
    }, tokens.student);
    assert.equal(result.status, 201);
    assert.equal(result.payload.reservation.estado, 'pendiente_aprobacion');
    return result.payload.reservation;
  });

  const loanId = await report('retiro, préstamo, solicitud de devolución y confirmación', async () => {
    assert.equal((await request('POST', `/api/admin/reservations/${reservationResponse.id}/approve`, {}, tokens.admin)).status, 200);
    const checkout = await request('POST', `/api/admin/reservations/${reservationResponse.id}/checkout`, {}, tokens.admin);
    assert.equal(checkout.status, 200);
    assert.equal(checkout.payload.loansCreated, 1);
    const adminOpenLoans = await request('GET', '/api/admin/open-loans', undefined, tokens.admin);
    assert.equal(adminOpenLoans.status, 200);
    assert.equal(adminOpenLoans.payload.loans.length, 1);
    assert.equal(adminOpenLoans.payload.loans[0].estado, 'activo');
    const pendingLoans = await request('GET', '/api/admin/loans', undefined, tokens.admin);
    assert.equal(pendingLoans.status, 200);
    assert.equal(pendingLoans.payload.loans.length, 1);
    assert.equal(pendingLoans.payload.loans[0].estado, 'activo');
    let loans = await request('GET', '/api/loans', undefined, tokens.student);
    assert.equal(loans.status, 200);
    assert.equal(loans.payload.loans.length, 1);
    const id = loans.payload.loans[0].id;
    const loan = loans.payload.loans[0];
    assert.equal(new Date(loan.vence_at).getTime(), loanDueAt(
      new Date(loan.retirada_at),
      reservationResponse.hora_devolucion ? String(reservationResponse.hora_devolucion).slice(0, 5) : null
    ).getTime());
    const requested = await request('POST', `/api/loans/${id}/return`, { horaPrevista: '01:02' }, tokens.student);
    assert.equal(requested.status, 202);
    const pending = await pool.query(`SELECT l.estado AS loan_estado, n.estado AS notebook_estado,
        n.prestado_a, r.hora_prevista,
        r.hora_prevista = ((r.solicitado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::time) AS hora_coincide
      FROM loans l JOIN notebooks n ON n.id = l.notebook_id
      JOIN returns r ON r.loan_id = l.id WHERE l.id = $1`, [id]);
    assert.equal(pending.rows[0].loan_estado, 'devolucion_pendiente');
    assert.equal(pending.rows[0].notebook_estado, 'pendiente_devolucion');
    assert.equal(String(pending.rows[0].prestado_a), users.student.id);
    assert.equal(pending.rows[0].hora_coincide, true);
    const horaPrevista = String(pending.rows[0].hora_prevista).slice(0, 5);
    const inventory = await request('GET', '/api/notebooks', undefined, tokens.admin);
    assert.ok(inventory.payload.notebooks.some((notebook) => notebook.id === loan.notebook
      && notebook.estado === 'pendiente_devolucion'));
    const returns = await request('GET', '/api/admin/returns', undefined, tokens.admin);
    assert.equal(returns.status, 200);
    assert.equal(returns.payload.returns[0].hora_prevista.slice(0, 5), horaPrevista);
    const pendingOpenLoans = await request('GET', '/api/admin/open-loans', undefined, tokens.admin);
    assert.equal(pendingOpenLoans.payload.loans[0].estado, 'devolucion_pendiente');
    assert.equal(pendingOpenLoans.payload.loans[0].return_id, returns.payload.returns[0].id);
    const returnRow = await pool.query("SELECT id FROM returns WHERE loan_id = $1", [id]);
    assert.equal(returnRow.rowCount, 1);
    await pool.query("UPDATE loans SET vence_at = now() - interval '1 minute' WHERE id = $1", [id]);
    assert.equal((await request('POST', `/api/admin/returns/${returnRow.rows[0].id}/confirm`, {}, tokens.admin)).status, 200);
    loans = await request('GET', '/api/loans', undefined, tokens.student);
    assert.equal(loans.payload.loans[0].estado, 'devuelto');
    assert.ok(loans.payload.loans[0].devuelta_at);
    assert.equal(loans.payload.loans[0].hora_prevista.slice(0, 5), horaPrevista);
    const confirmedNotebook = await pool.query(`SELECT n.estado, n.prestado_a FROM loans l
      JOIN notebooks n ON n.id = l.notebook_id WHERE l.id = $1`, [id]);
    assert.equal(confirmedNotebook.rows[0].estado, 'disponible');
    assert.equal(confirmedNotebook.rows[0].prestado_a, null);
    assert.deepEqual((await request('GET', '/api/admin/open-loans', undefined, tokens.admin)).payload.loans, []);
    const lateReturn = await pool.query('SELECT id FROM late_returns WHERE loan_id = $1', [id]);
    assert.equal(lateReturn.rowCount, 1);
    return id;
  });

  await report('checkout del profesor, recordatorio, ticket activo y devolución directa admin', async () => {
    const reserved = await request('POST', '/api/reservations', {
      tipo: 'individual', cantidad: 1, curso: '6°14°', carro: '1',
      retiroAt: reservationTime, horaDevolucion: '17:30', motivo: 'Prueba flujo profesor'
    }, tokens.professor);
    assert.equal(reserved.status, 201);
    const reservationId = reserved.payload.reservation.id;
    assert.equal((await request('POST', `/api/admin/reservations/${reservationId}/approve`, {}, tokens.admin)).status, 200);
    const checkout = await request('POST', `/api/admin/reservations/${reservationId}/checkout`, {}, tokens.admin);
    assert.equal(checkout.status, 200);
    assert.equal(checkout.payload.loansCreated, 1);
    let professorLoans = await request('GET', '/api/loans', undefined, tokens.professor);
    assert.equal(professorLoans.status, 200);
    const loan = professorLoans.payload.loans.find((item) => item.estado === 'activo');
    assert.ok(loan);
    let adminLoans = await request('GET', '/api/admin/loans', undefined, tokens.admin);
    assert.equal(adminLoans.status, 200);
    assert.ok(adminLoans.payload.loans.some((item) => String(item.id) === String(loan.id)));
    assert.ok(adminLoans.payload.loans.some((item) => String(item.id) === String(loan.id) && !item.vencido));
    const partialProfessorName = encodeURIComponent(users.professor.nombre.slice(0, 4));
    const searchedAdminLoans = await request('GET', `/api/admin/loans?q=${partialProfessorName}`, undefined, tokens.admin);
    assert.equal(searchedAdminLoans.status, 200);
    assert.ok(searchedAdminLoans.payload.loans.some((item) => String(item.id) === String(loan.id)));
    await pool.query(`UPDATE loans SET vence_at = now() + interval '20 minutes'
      WHERE id = $1`, [loan.id]);
    await pool.query(`UPDATE user_preferences SET email_notifications = TRUE, return_reminder_minutes = 30
      WHERE user_id = $1`, [users.professor.id]);
    assert.equal((await request('POST', '/api/internal/reminders', {})).status, 401);
    assert.equal((await request('POST', '/api/internal/reminders', {}, tokens.admin)).status, 401);
    const reminder = await request('POST', '/api/admin/reminders/run', {}, tokens.admin);
    assert.equal(reminder.status, 200);
    assert.ok(reminder.payload.sent >= 1);
    const firstMark = await pool.query('SELECT reminder_sent_at FROM loans WHERE id = $1', [loan.id]);
    assert.ok(firstMark.rows[0].reminder_sent_at);
    const noDuplicate = await request('POST', '/api/admin/reminders/run', {}, tokens.admin);
    assert.equal(noDuplicate.status, 200);
    const secondMark = await pool.query('SELECT reminder_sent_at FROM loans WHERE id = $1', [loan.id]);
    assert.equal(secondMark.rows[0].reminder_sent_at.toISOString(), firstMark.rows[0].reminder_sent_at.toISOString());

    await pool.query(`UPDATE loans SET reminder_sent_at = NULL WHERE id = $1`, [loan.id]);
    await pool.query(`UPDATE user_preferences SET return_reminder_minutes = 0 WHERE user_id = $1`, [users.professor.id]);
    assert.equal((await request('POST', '/api/admin/reminders/run', {}, tokens.admin)).status, 200);
    let thresholdMark = await pool.query('SELECT reminder_sent_at FROM loans WHERE id = $1', [loan.id]);
    assert.equal(thresholdMark.rows[0].reminder_sent_at, null);

    await pool.query(`UPDATE user_preferences SET return_reminder_minutes = 30, email_notifications = FALSE
      WHERE user_id = $1`, [users.professor.id]);
    assert.equal((await request('POST', '/api/admin/reminders/run', {}, tokens.admin)).status, 200);
    thresholdMark = await pool.query('SELECT reminder_sent_at FROM loans WHERE id = $1', [loan.id]);
    assert.equal(thresholdMark.rows[0].reminder_sent_at, null);

    await pool.query(`UPDATE user_preferences SET email_notifications = TRUE, return_reminder_minutes = 30
      WHERE user_id = $1`, [users.professor.id]);
    await pool.query(`UPDATE loans SET vence_at = now() - interval '5 minutes', reminder_sent_at = NULL WHERE id = $1`, [loan.id]);
    assert.equal((await request('POST', '/api/admin/reminders/run', {}, tokens.admin)).status, 200);
    thresholdMark = await pool.query('SELECT reminder_sent_at FROM loans WHERE id = $1', [loan.id]);
    assert.ok(thresholdMark.rows[0].reminder_sent_at, 'un préstamo vencido también recibe recordatorio');
    await pool.query(`UPDATE loans SET vence_at = now() + interval '20 minutes', reminder_sent_at = NULL WHERE id = $1`, [loan.id]);

    const ticketOne = await request('POST', '/api/tickets', {
      notebook: loan.notebook, motivo: 'Prueba', descripcion: 'Falla al devolver equipo prestado'
    }, tokens.professor);
    assert.equal(ticketOne.status, 201);
    const ticketReplyPath = `/api/tickets/${ticketOne.payload.ticket.id}/replies`;
    assert.equal((await request('POST', ticketReplyPath, { mensaje: 'Información adicional del profesor' }, tokens.professor)).status, 200);
    assert.equal((await request('POST', ticketReplyPath, { mensaje: 'Respuesta administrativa' }, tokens.admin)).status, 200);
    const professorReplies = await request('GET', ticketReplyPath, undefined, tokens.professor);
    assert.equal(professorReplies.status, 200);
    assert.ok(professorReplies.payload.replies.some((reply) => reply.mensaje === 'Respuesta administrativa'));
    assert.ok(professorReplies.payload.replies.some((reply) => reply.author_role === 'sistema'
      && /Recibimos tu reporte/.test(reply.mensaje)));
    let notebook = await pool.query(`SELECT n.estado, n.prestado_a FROM loans l
      JOIN notebooks n ON n.id = l.notebook_id WHERE l.id = $1`, [loan.id]);
    assert.equal(notebook.rows[0].estado, 'prestada');
    assert.equal(String(notebook.rows[0].prestado_a), users.professor.id);
    const ticketTwo = await request('POST', '/api/tickets', {
      notebook: loan.notebook, motivo: 'Prueba', descripcion: 'Segundo reporte'
    }, tokens.professor);
    assert.equal(ticketTwo.status, 201);

    const returned = await request('POST', `/api/admin/loans/${loan.id}/return`, {}, tokens.admin);
    assert.equal(returned.status, 200);
    const duplicateReturn = await request('POST', `/api/admin/loans/${loan.id}/return`, {}, tokens.admin);
    assert.equal(duplicateReturn.status, 409);
    professorLoans = await request('GET', '/api/loans', undefined, tokens.professor);
    assert.equal(professorLoans.payload.loans.find((item) => String(item.id) === String(loan.id)).estado, 'devuelto');
    adminLoans = await request('GET', '/api/admin/loans', undefined, tokens.admin);
    assert.ok(!adminLoans.payload.loans.some((item) => String(item.id) === String(loan.id)));
    const returnHistory = await request('GET', `/api/admin/returns?estado=confirmada&q=${loan.id}`, undefined, tokens.admin);
    assert.equal(returnHistory.status, 200);
    assert.ok(returnHistory.payload.returns.some((item) => String(item.loan_id) === String(loan.id)
      && String(item.receptor_id) === users.admin.id));
    const returnCount = await pool.query('SELECT COUNT(*)::integer AS count FROM returns WHERE loan_id = $1', [loan.id]);
    assert.equal(returnCount.rows[0].count, 1);
    notebook = await pool.query(`SELECT n.estado, n.prestado_a FROM loans l
      JOIN notebooks n ON n.id = l.notebook_id WHERE l.id = $1`, [loan.id]);
    assert.equal(notebook.rows[0].estado, 'mantenimiento');
    assert.equal(notebook.rows[0].prestado_a, null);

    assert.equal((await request('PATCH', `/api/tickets/${ticketOne.payload.ticket.id}`, {
      estado: 'resuelto'
    }, tokens.admin)).status, 200);
    notebook = await pool.query('SELECT estado FROM notebooks WHERE codigo = $1', [loan.notebook]);
    assert.equal(notebook.rows[0].estado, 'mantenimiento');
    assert.equal((await request('PATCH', `/api/tickets/${ticketTwo.payload.ticket.id}`, {
      estado: 'progreso'
    }, tokens.admin)).status, 200);
    assert.equal((await request('PATCH', `/api/tickets/${ticketTwo.payload.ticket.id}`, {
      estado: 'resuelto'
    }, tokens.admin)).status, 200);
    notebook = await pool.query('SELECT estado FROM notebooks WHERE codigo = $1', [loan.notebook]);
    assert.equal(notebook.rows[0].estado, 'disponible');
  });

  await report('inventario expone todos los estados físicos y filtra reservas sin ocultarlos', async () => {
    const loan = await pool.query('SELECT notebook_id FROM loans WHERE id = $1', [loanId]);
    const linkedNotebook = await pool.query(`SELECT rn.reservation_id, n.id, n.codigo, n.estado, n.prestado_a
      FROM loans l JOIN notebooks n ON n.id = l.notebook_id
      JOIN reservation_notebooks rn ON rn.notebook_id = n.id WHERE l.id = $1`, [loanId]);
    const otherCodes = (await pool.query('SELECT codigo FROM notebooks ORDER BY codigo')).rows
      .map((row) => row.codigo)
      .filter((code) => code !== linkedNotebook.rows[0].codigo)
      .slice(0, 4);
    const inventoryStates = [
      [otherCodes[0], 'disponible', null],
      [otherCodes[1], 'prestada', users.student.id],
      [otherCodes[2], 'mantenimiento', null],
      [otherCodes[3], 'pendiente_devolucion', users.student.id]
    ];
    const codes = inventoryStates.map(([code]) => code);
    const previous = await pool.query(`SELECT codigo, estado, prestado_a FROM notebooks WHERE codigo = ANY($1::text[])`, [codes]);
    try {
      await pool.query(`UPDATE reservation_notebooks SET active = FALSE
        WHERE notebook_id IN (SELECT id FROM notebooks WHERE codigo = ANY($1::text[]))`, [codes]);
      for (const [code, estado, ownerId] of inventoryStates) {
        await pool.query('UPDATE notebooks SET estado = $1::notebook_status, prestado_a = $2::bigint WHERE codigo = $3',
          [estado, ownerId, code]);
      }
      await pool.query('UPDATE reservation_notebooks SET active = TRUE WHERE reservation_id = $1 AND notebook_id = $2',
        [linkedNotebook.rows[0].reservation_id, loan.rows[0].notebook_id]);
      await pool.query(`UPDATE notebooks SET estado = 'pendiente_devolucion', prestado_a = $2 WHERE id = $1`,
        [linkedNotebook.rows[0].id, users.student.id]);
      const response = await request('GET', '/api/notebooks', undefined, tokens.admin);
      assert.equal(response.status, 200);
      for (const [code, estado] of inventoryStates) {
        assert.ok(response.payload.notebooks.some((notebook) => notebook.id === code && notebook.estado === estado),
          `${code} debería figurar como ${estado}: ${JSON.stringify(response.payload.notebooks.filter((notebook) => notebook.id === code))}`);
      }
      assert.ok(response.payload.notebooks.some((notebook) => notebook.id === linkedNotebook.rows[0].codigo
        && notebook.estado === 'pendiente_devolucion'));
    } finally {
      await pool.query('UPDATE reservation_notebooks SET active = FALSE WHERE reservation_id = $1 AND notebook_id = $2',
        [linkedNotebook.rows[0].reservation_id, linkedNotebook.rows[0].id]);
      await pool.query(`UPDATE notebooks SET estado = $1::notebook_status, prestado_a = $2
        WHERE id = $3`, [linkedNotebook.rows[0].estado, linkedNotebook.rows[0].prestado_a, linkedNotebook.rows[0].id]);
      for (const row of previous.rows) {
        await pool.query('UPDATE notebooks SET estado = $1::notebook_status, prestado_a = $2 WHERE codigo = $3',
          [row.estado, row.prestado_a, row.codigo]);
      }
    }
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

  await report('progreso y resolución respetan préstamos y otros tickets activos', async () => {
    async function createTicket(code, notebookId) {
      await pool.query(`INSERT INTO tickets (codigo, notebook_id, owner_id, motivo, descripcion)
        VALUES ($1, $2, $3, 'Prueba', 'Transición de estado de notebook')`, [code, notebookId, users.student.id]);
    }
    const available = await pool.query("SELECT id FROM notebooks WHERE codigo = 'NB-001'");
    const shared = await pool.query("SELECT id FROM notebooks WHERE codigo = 'NB-004'");
    await pool.query("UPDATE notebooks SET estado = 'disponible', prestado_a = NULL WHERE id = $1", [available.rows[0].id]);
    await createTicket('TCK-TRANSITION-1', available.rows[0].id);
    const first = await request('PATCH', '/api/tickets/TCK-TRANSITION-1', { estado: 'progreso' }, tokens.admin);
    assert.equal(first.status, 200);
    let status = await pool.query('SELECT estado FROM notebooks WHERE id = $1', [available.rows[0].id]);
    assert.equal(status.rows[0].estado, 'mantenimiento');

    await createTicket('TCK-TRANSITION-2', available.rows[0].id);
    await createTicket('TCK-TRANSITION-3', available.rows[0].id);
    await pool.query("UPDATE tickets SET estado = 'progreso' WHERE codigo = 'TCK-TRANSITION-3'");
    assert.equal((await request('PATCH', '/api/tickets/TCK-TRANSITION-1', { estado: 'resuelto' }, tokens.admin)).status, 200);
    status = await pool.query('SELECT estado FROM notebooks WHERE id = $1', [available.rows[0].id]);
    assert.equal(status.rows[0].estado, 'mantenimiento');
    assert.equal((await request('PATCH', '/api/tickets/TCK-TRANSITION-2', { estado: 'resuelto' }, tokens.admin)).status, 200);
    status = await pool.query('SELECT estado FROM notebooks WHERE id = $1', [available.rows[0].id]);
    assert.equal(status.rows[0].estado, 'mantenimiento');
    assert.equal((await request('PATCH', '/api/tickets/TCK-TRANSITION-3', { estado: 'resuelto' }, tokens.admin)).status, 200);
    status = await pool.query('SELECT estado FROM notebooks WHERE id = $1', [available.rows[0].id]);
    assert.equal(status.rows[0].estado, 'disponible');

    await pool.query("UPDATE notebooks SET estado = 'mantenimiento' WHERE id = $1", [available.rows[0].id]);
    assert.equal((await request('PATCH', '/api/tickets/TCK-TRANSITION-1', { estado: 'abierto' }, tokens.admin)).status, 200);
    status = await pool.query('SELECT estado FROM notebooks WHERE id = $1', [available.rows[0].id]);
    assert.equal(status.rows[0].estado, 'mantenimiento');

    for (const estado of ['prestada', 'pendiente_devolucion']) {
      await pool.query('UPDATE notebooks SET estado = $1::notebook_status, prestado_a = $2 WHERE id = $3',
        [estado, users.student.id, shared.rows[0].id]);
      const code = `TCK-STATE-${estado}`;
      await createTicket(code, shared.rows[0].id);
      assert.equal((await request('PATCH', `/api/tickets/${code}`, { estado: 'progreso' }, tokens.admin)).status, 200);
      status = await pool.query('SELECT estado, prestado_a FROM notebooks WHERE id = $1', [shared.rows[0].id]);
      assert.equal(status.rows[0].estado, estado);
      assert.equal(String(status.rows[0].prestado_a), users.student.id);
    }
  });

  await report('cambio de estado de tickets con todos los estados de notebook', async () => {
    const notebookCases = [
      { code: 'NB-STATE-AVAILABLE', estado: 'disponible' },
      { code: 'NB-STATE-LOANED', estado: 'prestada' },
      { code: 'NB-STATE-MAINTENANCE', estado: 'mantenimiento' },
      { code: null, estado: null }
    ];
    for (const notebook of notebookCases.filter(({ code }) => code)) {
      await pool.query(`INSERT INTO notebooks (codigo, estado, ubicacion, prestado_a)
        VALUES ($1, $2, 'Pruebas', $3)`,
      [notebook.code, notebook.estado, notebook.estado === 'prestada' ? users.admin.id : null]);
      await pool.query(`INSERT INTO loans (notebook_id, user_id, retirada_at, vence_at, devuelta_at, estado)
        SELECT id, $1, now() - interval '2 hours', now() - interval '1 hour',
          now() - interval '30 minutes', 'devuelto'
        FROM notebooks WHERE codigo = $2`, [users.student.id, notebook.code]);
    }
    for (const notebook of notebookCases) {
      for (const estado of ['abierto', 'progreso', 'resuelto']) {
        const created = await request('POST', '/api/tickets', {
          ...(notebook.code ? { notebook: notebook.code } : {}),
          motivo: 'Prueba de estado', descripcion: 'Prueba de regresión enum'
        }, tokens.student);
        assert.equal(created.status, 201, `${notebook.code || 'sin notebook'}: ${JSON.stringify(created.payload)}`);
        if (notebook.code) {
          await pool.query('UPDATE notebooks SET estado = $1, prestado_a = $2 WHERE codigo = $3',
            [notebook.estado, notebook.estado === 'prestada' ? users.admin.id : null, notebook.code]);
        }
        const changed = await request('PATCH', `/api/tickets/${encodeURIComponent(created.payload.ticket.id)}`,
          { estado }, tokens.admin);
        assert.equal(changed.status, 200, `${estado}, notebook ${notebook.estado || 'sin notebook'}`);
        assert.equal(changed.payload.ticket.estado, estado);
      }
    }
  });

  await report('reserva individual de profesor: cantidad, aprobación y rechazo', async () => {
    const individual = await request('POST', '/api/reservations', {
      tipo: 'individual', retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 2, curso: '6°14°', carro: '1'
    }, tokens.professor);
    assert.equal(individual.status, 201);
    assert.equal(individual.payload.reservation.estado, 'pendiente_aprobacion');
    assert.equal((await request('POST', `/api/admin/reservations/${individual.payload.reservation.id}/approve`, {}, tokens.admin)).status, 200);
    assert.equal((await request('POST', `/api/admin/reservations/${individual.payload.reservation.id}/reject`, {}, tokens.admin)).status, 200);
    const rejected = await pool.query(`SELECT estado FROM reservations WHERE id = $1`, [individual.payload.reservation.id]);
    const activeLinks = await pool.query('SELECT COUNT(*)::integer AS count FROM reservation_notebooks WHERE reservation_id = $1 AND active', [individual.payload.reservation.id]);
    assert.equal(rejected.rows[0].estado, 'rechazada');
    assert.equal(activeLinks.rows[0].count, 0);
  });

  await report('lote profesor, aprobación y rechazo', async () => {
    const lot = await request('POST', '/api/reservations', {
      tipo: 'lote', retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 3, curso: '6°14°', carro: '1'
    }, tokens.professor);
    assert.equal(lot.status, 201, JSON.stringify(lot.payload));
    assert.equal(lot.payload.reservation.estado, 'pendiente_aprobacion');
    assert.equal((await request('POST', `/api/admin/reservations/${lot.payload.reservation.id}/approve`, {}, tokens.admin)).status, 200);
    assert.equal((await request('POST', `/api/admin/reservations/${lot.payload.reservation.id}/reject`, {}, tokens.admin)).status, 200);
  });

  await report('cancelación de reserva', async () => {
    const created = await request('POST', '/api/reservations', {
      retiroAt: reservationTime, horaDevolucion: '17:30', cantidad: 1, curso: '6°14°', carro: '1'
    }, tokens.cancel);
    assert.equal(created.status, 201);
    const code = created.payload.reservation.id_codigo;
    assert.equal((await request('DELETE', `/api/reservations/${encodeURIComponent(code)}`, undefined, await login(users.cancel))).status, 200);
  });

  await report('validaciones y alta administrativa de usuario', async () => {
    const rejected = await request('POST', '/api/admin/users', {
      nombre: 'Inválido', apellido: 'Test', email: 'invalid-user@netmo.invalid',
      dni: '9900010', rol: 'alumno', password: 'short'
    }, tokens.admin);
    assert.equal(rejected.status, 400);
    const created = await request('POST', '/api/admin/users', {
      nombre: 'Nuevo', apellido: 'Usuario', email: 'new-user@gmail.com',
      dni: '9900010', rol: 'alumno', password: 'Abcd1234', passwordConfirmation: 'Abcd1234'
    }, tokens.admin);
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    await pool.query('UPDATE users SET email = upper(email) WHERE id = $1', [created.payload.user.id]);
    const successfulLogin = await request('POST', '/api/auth/login', {
      email: 'NEW-USER@GMAIL.COM',
      password: 'Abcd1234'
    });
    assert.equal(successfulLogin.status, 200);
    const invalidLogin = await request('POST', '/api/auth/login', {
      email: 'new-user@gmail.com',
      password: 'incorrecta'
    });
    assert.equal(invalidLogin.status, 401);
    const duplicate = await request('POST', '/api/admin/users', {
      nombre: 'Otro', apellido: 'Usuario', email: 'new-user@gmail.com',
      dni: '9900011', rol: 'alumno', password: 'Abcd1234', passwordConfirmation: 'Abcd1234'
    }, tokens.admin);
    assert.equal(duplicate.status, 409);
  });

  await report('registro público con aprobación, rechazo y reintento', async () => {
    const registration = {
      nombre: 'Registro', apellido: 'Pendiente', email: 'registro-pendiente@gmail.com',
      dni: '9900030', rol: 'alumno', password: 'registro-pass-2026', passwordConfirmation: 'registro-pass-2026'
    };
    const created = await request('POST', '/api/auth/register', registration);
    assert.equal(created.status, 201);
    assert.equal(created.payload.user.estado_registro, 'pendiente');
    assert.equal((await request('POST', '/api/auth/login', {
      email: registration.email, password: registration.password
    })).status, 403);

    const pending = await request('GET', '/api/admin/users?registro=pendiente', undefined, tokens.admin);
    assert.ok(pending.payload.users.some((user) => user.dni === registration.dni));
    assert.ok(!pending.payload.users.some((user) => user.dni === '990001'));
    assert.equal((await request('POST', `/api/admin/users/${registration.dni}/approve`, { rol: 'alumno' }, tokens.admin)).status, 200);
    assert.equal((await request('POST', '/api/auth/login', {
      email: registration.email, password: registration.password
    })).status, 200);

    const rejectedRegistration = {
      nombre: 'Registro', apellido: 'Rechazado', email: 'registro-rechazado@gmail.com',
      dni: '9900031', rol: 'alumno', password: 'registro-pass-2026', passwordConfirmation: 'registro-pass-2026'
    };
    assert.equal((await request('POST', '/api/auth/register', rejectedRegistration)).status, 201);
    assert.equal((await request('POST', `/api/admin/users/${rejectedRegistration.dni}/reject`, {}, tokens.admin)).status, 200);
    assert.equal((await request('POST', '/api/auth/login', {
      email: rejectedRegistration.email, password: rejectedRegistration.password
    })).status, 403);

    const reRegistered = await request('POST', '/api/auth/register', {
      ...rejectedRegistration,
      nombre: 'Registro Corregido',
      password: 'registro-pass-2027',
      passwordConfirmation: 'registro-pass-2027'
    });
    assert.equal(reRegistered.status, 201);
    assert.equal(reRegistered.payload.user.estado_registro, 'pendiente');
    assert.equal((await request('POST', `/api/admin/users/${rejectedRegistration.dni}/approve`, { rol: 'alumno' }, tokens.admin)).status, 200);
    assert.equal((await request('POST', '/api/auth/login', {
      email: rejectedRegistration.email, password: 'registro-pass-2027'
    })).status, 200);
  });

  await report('baja definitiva de datos personales y re-registro con el mismo correo', async () => {
    const email = 'baja-temporal@gmail.com';
    const dni = '9900020';
    const created = await request('POST', '/api/admin/users', {
      nombre: 'Baja', apellido: 'Temporal', email,
      dni, rol: 'alumno', password: 'BajaTemp2026', passwordConfirmation: 'BajaTemp2026'
    }, tokens.admin);
    assert.equal(created.status, 201);
    const userId = created.payload.user.id;

    assert.equal((await request('DELETE', `/api/admin/users/${dni}`, undefined, tokens.admin)).status, 200);
    const anonymized = await pool.query('SELECT nombre, email, dni, eliminado_at FROM users WHERE id = $1', [userId]);
    assert.equal(anonymized.rows[0].nombre, 'Cuenta eliminada');
    assert.equal(anonymized.rows[0].email, `eliminado+${userId}@netmo.invalid`);
    assert.equal(anonymized.rows[0].dni, `ELIM-${userId}`);
    assert.ok(anonymized.rows[0].eliminado_at);

    const activeUsers = await request('GET', '/api/admin/users', undefined, tokens.admin);
    assert.ok(!activeUsers.payload.users.some((item) => item.email === email));
    const deletedUsers = await request('GET', '/api/admin/users?eliminados=si', undefined, tokens.admin);
    assert.ok(deletedUsers.payload.users.some((item) => item.email === `eliminado+${userId}@netmo.invalid`));
    assert.equal((await request('POST', '/api/auth/login', {
      email, password: 'BajaTemp2026'
    })).status, 401);

    const reRegistered = await request('POST', '/api/auth/register', {
      nombre: 'Baja', apellido: 'Temporal', email, dni,
      password: 'BajaTemp2027', passwordConfirmation: 'BajaTemp2027'
    });
    assert.equal(reRegistered.status, 201);
    assert.equal(reRegistered.payload.user.estado_registro, 'pendiente');
    const current = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    assert.equal(current.rowCount, 1);
    assert.notEqual(String(current.rows[0].id), String(userId));
    assert.equal((await request('POST', `/api/admin/users/${dni}/approve`, { rol: 'alumno' }, tokens.admin)).status, 200);
    assert.equal((await request('POST', '/api/auth/login', {
      email, password: 'BajaTemp2026'
    })).status, 401);
    assert.equal((await request('POST', '/api/auth/login', {
      email, password: 'BajaTemp2027'
    })).status, 200);
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
    const locationBefore = await pool.query('SELECT id FROM ubicaciones WHERE slug = $1', ['taller']);
    const linkedCarBefore = await pool.query('SELECT id, ubicacion_id FROM carros WHERE numero = $1', [2]);
    const linked = await request('PATCH', '/api/admin/carros/2', { ubicacion: 'taller' }, tokens.admin);
    assert.equal(linked.status, 200, JSON.stringify(linked.payload));
    const renamedLocation = await request('PATCH', '/api/admin/ubicaciones/taller', {
      nombre: 'Piso 6767'
    }, tokens.admin);
    assert.equal(renamedLocation.status, 200);
    assert.equal(renamedLocation.payload.ubicacion.slug, 'piso-6767');
    const locationAfter = await pool.query('SELECT id FROM ubicaciones WHERE slug = $1', ['piso-6767']);
    const linkedCarAfter = await pool.query('SELECT id, ubicacion_id FROM carros WHERE numero = $1', [2]);
    assert.equal(String(locationAfter.rows[0].id), String(locationBefore.rows[0].id));
    assert.equal(String(linkedCarAfter.rows[0].id), String(linkedCarBefore.rows[0].id));
    assert.equal(String(linkedCarAfter.rows[0].ubicacion_id), String(locationAfter.rows[0].id));
    assert.equal((await request('PATCH', '/api/admin/ubicaciones/piso-6767', {
      nombre: 'Taller'
    }, tokens.admin)).payload.ubicacion.slug, 'taller');

    const stableCar = await pool.query('SELECT id FROM carros WHERE numero = $1', [1]);
    const loanRelationsBefore = await pool.query(`SELECT l.id, n.carro_id FROM loans l
      JOIN notebooks n ON n.id = l.notebook_id WHERE n.carro_id = $1 ORDER BY l.id`, [stableCar.rows[0].id]);
    assert.ok(loanRelationsBefore.rowCount > 0);
    assert.equal((await request('PATCH', '/api/admin/carros/1', { numero: 4 }, tokens.admin)).status, 200);
    const loanRelationsAfter = await pool.query(`SELECT l.id, n.carro_id FROM loans l
      JOIN notebooks n ON n.id = l.notebook_id WHERE n.carro_id = $1 ORDER BY l.id`, [stableCar.rows[0].id]);
    assert.deepEqual(loanRelationsAfter.rows, loanRelationsBefore.rows);
    assert.equal((await pool.query('SELECT COUNT(*)::integer AS count FROM carros WHERE numero = $1', [4])).rows[0].count, 1);
    const inventory = (await request('GET', '/api/notebooks', undefined, tokens.admin)).payload.notebooks;
    assert.ok(inventory.filter((item) => ['NB-020', 'NB-021'].includes(item.id))
      .every((item) => Number(item.carro_id) === 2));
    const renumberedNotebooks = inventory.filter((item) => /^NB-00[1-8]$/.test(item.id));
    assert.equal(renumberedNotebooks.length, 8);
    assert.ok(renumberedNotebooks.every((item) => Number(item.carro_id) === 4));
    assert.equal((await request('PATCH', '/api/notebooks/NB-020', { estado: 'mantenimiento' }, tokens.admin)).status, 200);
    assert.equal((await request('PATCH', '/api/notebooks/NB-020', { estado: 'disponible' }, tokens.admin)).status, 200);
  });

  await report('aplicar y quitar baneo administrativo', async () => {
    assert.equal((await request('PATCH', `/api/admin/users/${users.cancel.dni}`, {
      baneado: true, duracionDias: 3
    }, tokens.admin)).status, 200);
    const blocked = await request('POST', '/api/auth/login', {
      email: users.cancel.email, password: users.cancel.password
    });
    assert.equal(blocked.status, 403);
    assert.equal((await request('PATCH', `/api/admin/users/${users.cancel.dni}`, {
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
    assert.equal((await request('POST', '/api/auth/forgot', { email: users.resetExpiry.email })).status, 200);
    const expiryCode = deliveredCodes.get(users.resetExpiry.email);
    assert.ok(expiryCode, 'el proveedor GAS de test recibió el código de vencimiento');
    await pool.query(`UPDATE password_resets SET expires_at = now() - interval '1 second'
      WHERE user_id = $1 AND purpose = 'reset'`, [users.resetExpiry.id]);
    const expired = await request('POST', '/api/auth/reset', {
      email: users.resetExpiry.email, code: expiryCode, password: 'new-pass-2026'
    });
    assert.equal(expired.status, 400, `reset vencido: ${JSON.stringify(expired.payload)}`);

    const usedCode = deliveredCodes.get(users.resetUsed.email);
    assert.ok(usedCode, 'el proveedor GAS de test recibió el código válido');
    const reset = await request('POST', '/api/auth/reset', {
      email: users.resetUsed.email, code: usedCode, password: 'new-pass-2026'
    });
    assert.equal(reset.status, 200, `reset válido: ${JSON.stringify(reset.payload)}`);
    const reuse = await request('POST', '/api/auth/reset', {
      email: users.resetUsed.email, code: usedCode, password: 'new-pass-2026'
    });
    assert.equal(reuse.status, 400);

    await request('POST', '/api/auth/forgot', { email: users.resetAttempts.email });
    const wrongCode = deliveredCodes.get(users.resetAttempts.email) === '000000' ? '000001' : '000000';
    const invalidPassword = await request('POST', '/api/auth/reset', {
      email: users.resetAttempts.email, code: deliveredCodes.get(users.resetAttempts.email), password: 'bad password'
    });
    assert.equal(invalidPassword.status, 400, `reset con clave inválida: ${JSON.stringify(invalidPassword.payload)}`);
    const attemptsBeforeWrongCode = await pool.query(
      "SELECT attempts FROM password_resets WHERE user_id = $1 AND purpose = 'reset'", [users.resetAttempts.id]
    );
    assert.equal(attemptsBeforeWrongCode.rows[0].attempts, 0);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failed = await request('POST', '/api/auth/reset', {
        email: users.resetAttempts.email, code: wrongCode, password: 'new-pass-2026'
      });
      assert.equal(failed.status, 400, `intento ${attempt + 1}: ${JSON.stringify(failed.payload)}`);
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

    const wrongCurrentPassword = await request('POST', '/api/auth/change-password', {
      currentPassword: 'contraseña-incorrecta', password: 'final-pass-2026'
    }, tokens.student);
    assert.equal(wrongCurrentPassword.status, 400);
    const currentPasswordChange = await request('POST', '/api/auth/change-password', {
      currentPassword: 'changed-pass-2026', password: 'final-pass-2026'
    }, tokens.student);
    assert.equal(currentPasswordChange.status, 200);
    assert.equal((await request('POST', '/api/auth/login', {
      email: users.student.email, password: 'final-pass-2026'
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
    assert.equal(restored.status, 200, JSON.stringify(restored.payload));
    const afterRestore = await request('GET', '/api/admin/backup', undefined, tokens.admin);
    assert.equal(afterRestore.status, 200, JSON.stringify(afterRestore.payload));
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
    cases.push(['frase incorrecta', { backup: originalBackupResponse, password: users.admin.password, confirmation: 'CONFIRMAR' }, 400]);
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

  await report('el quinto retraso bloquea la cuenta siete días y el desbloqueo reinicia el contador', async () => {
    const notebook = await pool.query(`SELECT n.id FROM notebooks n
      WHERE NOT EXISTS (SELECT 1 FROM loans l WHERE l.notebook_id = n.id AND l.estado <> 'devuelto')
      ORDER BY n.id LIMIT 1`);
    assert.ok(notebook.rowCount, 'debe haber una notebook disponible');
    const notebookId = notebook.rows[0].id;

    async function registerLateReturn() {
      const loan = await pool.query(`INSERT INTO loans (notebook_id, user_id, vence_at, estado)
        VALUES ($1, $2, now() - interval '1 hour', 'activo') RETURNING id`,
      [notebookId, users.lateBlock.id]);
      await pool.query("UPDATE notebooks SET estado = 'prestada', prestado_a = $2 WHERE id = $1",
        [notebookId, users.lateBlock.id]);
      const response = await request('POST', `/api/admin/loans/${loan.rows[0].id}/return`, {}, tokens.admin);
      assert.equal(response.status, 200, JSON.stringify(response.payload));
    }

    for (let index = 0; index < 4; index += 1) await registerLateReturn();
    let summary = await request('GET', '/api/admin/late-returns', undefined, tokens.admin);
    let row = summary.payload.users.find((user) => user.dni === users.lateBlock.dni);
    assert.equal(row.tardanzas, 4);
    assert.equal(row.bloqueo_automatico, false);
    assert.equal(row.baneado, false);
    assert.equal((await request('POST', '/api/auth/login', {
      email: users.lateBlock.email, password: users.lateBlock.password
    })).status, 200);

    await registerLateReturn();
    const denied = await request('POST', '/api/auth/login', {
      email: users.lateBlock.email, password: users.lateBlock.password
    });
    assert.equal(denied.status, 403);
    assert.match(denied.payload.error, /bloqueada automáticamente/i);
    assert.match(denied.payload.error, /5 devoluciones tardías/i);

    const blockedUser = await pool.query(`SELECT baneado, baneo_origen, baneado_hasta
      FROM users WHERE id = $1`, [users.lateBlock.id]);
    assert.equal(blockedUser.rows[0].baneado, true);
    assert.equal(blockedUser.rows[0].baneo_origen, 'automatico');
    const remainingHours = (new Date(blockedUser.rows[0].baneado_hasta).getTime() - Date.now()) / 3_600_000;
    assert.ok(remainingHours > 24 * 6.9 && remainingHours <= 24 * 7.1, 'el bloqueo debe durar siete días');

    summary = await request('GET', '/api/admin/late-returns', undefined, tokens.admin);
    row = summary.payload.users.find((user) => user.dni === users.lateBlock.dni);
    assert.equal(row.tardanzas, 5);
    assert.equal(row.bloqueo_automatico, true);
    assert.equal(row.baneado, true);
    assert.equal(row.baneo_origen, 'automatico');

    const audit = await pool.query(`SELECT COUNT(*)::integer AS total FROM audit_log
      WHERE accion = 'bloqueo_automatico' AND detalle::jsonb->>'user_id' = $1`, [String(users.lateBlock.id)]);
    assert.equal(audit.rows[0].total, 1, 'el bloqueo automático se audita una sola vez');

    await registerLateReturn();
    const auditAfterSixth = await pool.query(`SELECT COUNT(*)::integer AS total FROM audit_log
      WHERE accion = 'bloqueo_automatico' AND detalle::jsonb->>'user_id' = $1`, [String(users.lateBlock.id)]);
    assert.equal(auditAfterSixth.rows[0].total, 1, 'una demora extra estando bloqueado no duplica el bloqueo');

    const unblocked = await request('PATCH', `/api/admin/users/${users.lateBlock.dni}`, {
      baneado: false
    }, tokens.admin);
    assert.equal(unblocked.status, 200);
    const resetUser = await pool.query(`SELECT baneado, baneo_origen, tardanzas_reset_at
      FROM users WHERE id = $1`, [users.lateBlock.id]);
    assert.equal(resetUser.rows[0].baneado, false);
    assert.equal(resetUser.rows[0].baneo_origen, null);
    assert.ok(resetUser.rows[0].tardanzas_reset_at);
    summary = await request('GET', '/api/admin/late-returns', undefined, tokens.admin);
    row = summary.payload.users.find((user) => user.dni === users.lateBlock.dni);
    assert.equal(row.tardanzas, 0, 'el desbloqueo reinicia el contador sin borrar el historial');
    assert.equal((await request('POST', '/api/auth/login', {
      email: users.lateBlock.email, password: users.lateBlock.password
    })).status, 200);

    await pool.query(`UPDATE users SET baneado = TRUE, baneo_origen = 'automatico',
      baneado_hasta = now() - interval '1 minute' WHERE id = $1`, [users.lateBlock.id]);
    assert.equal((await request('POST', '/api/auth/login', {
      email: users.lateBlock.email, password: users.lateBlock.password
    })).status, 200, 'el vencimiento del bloqueo permite ingresar');
    const expired = await pool.query(`SELECT baneado, baneo_origen, tardanzas_reset_at
      FROM users WHERE id = $1`, [users.lateBlock.id]);
    assert.equal(expired.rows[0].baneado, false);
    assert.equal(expired.rows[0].baneo_origen, null);
    assert.ok(expired.rows[0].tardanzas_reset_at, 'el vencimiento también reinicia el contador');
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
