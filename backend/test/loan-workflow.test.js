const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { after, test } = require('node:test');

process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/netmo_workflow_test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-hmac';

const db = require('../data/database');
const authService = require('../services/auth-service');
const { parseBusinessDateTime, businessTimeParts } = require('../services/business-time');
const controller = require('../controllers/api-controller');
const routes = require('../routes');

after(() => db.pool.end());

function nextBusinessReservationTime() {
  const now = new Date();
  const parts = businessTimeParts(now);
  const day = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  for (let offset = 0; offset < 8; offset += 1) {
    const candidateDay = new Date(day + offset * 24 * 60 * 60 * 1000);
    const weekday = candidateDay.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const date = `${candidateDay.getUTCFullYear()}-${String(candidateDay.getUTCMonth() + 1).padStart(2, '0')}-${String(candidateDay.getUTCDate()).padStart(2, '0')}`;
    const time = parseBusinessDateTime(`${date}T10:00`);
    if (time > now) return time;
  }
  throw new Error('No se encontró un día hábil para la prueba');
}

test('flujo API reserva, retiro, préstamo, devolución e historial', async () => {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  const originalAuthenticate = authService.authenticate;
  const user = { id: '7', legajo: '123', nombre: 'Ana Pérez', rol: 'profesor' };
  const notebook = { id: '11', codigo: 'NB-011', estado: 'disponible' };
  let reservation;
  let reservationLink = null;
  let loan = null;
  let returnRequest = null;

  const execute = async (sql, params = []) => {
    const statement = sql.replace(/\s+/g, ' ').trim();
    if (statement.startsWith('SELECT 1 FROM loans WHERE user_id')) return { rowCount: 0, rows: [] };
    if (statement.startsWith('SELECT numero FROM carros WHERE numero =')) return { rowCount: 1, rows: [{ numero: params[0] }] };
    if (statement.startsWith('SELECT n.id FROM notebooks n')) return { rowCount: notebook.estado === 'disponible' ? 1 : 0, rows: notebook.estado === 'disponible' ? [{ id: notebook.id }] : [] };
    if (statement.startsWith('INSERT INTO reservations')) {
      reservation = {
        id: '77', codigo: params[0], owner_id: params[1], tipo: params[2], carro: params[3], curso: params[4],
        cantidad: params[5], retiro_at: params[6], motivo: params[7], estado: params[8]
      };
      return { rowCount: 1, rows: [reservation] };
    }
    if (statement.startsWith('INSERT INTO reservation_notebooks')) {
      reservationLink = { reservation_id: params[0], notebook_id: params[1], active: true };
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith('SELECT id, owner_id, tipo, curso, cantidad, retiro_at, estado, carro FROM reservations')) {
      return { rowCount: reservation ? 1 : 0, rows: reservation ? [reservation] : [] };
    }
    if (statement.startsWith('SELECT id FROM loans WHERE reservation_id')) return { rowCount: loan ? 1 : 0, rows: loan ? [{ id: loan.id }] : [] };
    if (statement.startsWith('UPDATE reservation_notebooks rn SET active = FALSE')) {
      if (reservationLink && notebook.estado !== 'disponible') reservationLink.active = false;
      return { rowCount: 0, rows: [] };
    }
    if (statement.startsWith('SELECT n.id, n.codigo FROM reservation_notebooks')) {
      return { rowCount: reservationLink?.active ? 1 : 0, rows: reservationLink?.active ? [{ id: notebook.id, codigo: notebook.codigo }] : [] };
    }
    if (statement.startsWith('INSERT INTO loans')) {
      loan = {
        id: '80', notebook_id: notebook.id, notebook: notebook.codigo, user_id: user.id,
        reservation_id: params[2], curso: params[3], retirada_at: params[4], vence_at: params[5],
        devuelta_at: null, estado: 'activo'
      };
      return { rowCount: 1, rows: [loan] };
    }
    if (statement.startsWith("UPDATE notebooks SET estado = 'prestada'")) {
      notebook.estado = 'prestada';
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith('UPDATE reservation_notebooks SET active = FALSE')) {
      if (reservationLink) reservationLink.active = false;
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith("UPDATE reservations SET estado = 'retirada'")) {
      reservation.estado = 'retirada';
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith("UPDATE loans SET estado = 'devolucion_pendiente'")) {
      if (!loan || loan.id !== String(params[0]) || loan.user_id !== String(params[1]) || loan.estado !== 'activo') return { rowCount: 0, rows: [] };
      loan.estado = 'devolucion_pendiente';
      return { rowCount: 1, rows: [{ id: loan.id, notebook_id: notebook.id }] };
    }
    if (statement.startsWith('INSERT INTO returns')) {
      returnRequest = { id: '90', loan_id: params[0], estado: 'pendiente' };
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith("UPDATE notebooks SET estado = 'pendiente_devolucion'")) {
      notebook.estado = 'pendiente_devolucion';
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith("UPDATE returns SET estado = 'confirmada'")) {
      if (!returnRequest || returnRequest.id !== String(params[1])) return { rowCount: 0, rows: [] };
      returnRequest.estado = 'confirmada';
      return { rowCount: 1, rows: [{ loan_id: loan.id }] };
    }
    if (statement.startsWith("UPDATE loans SET estado = 'devuelto'")) {
      loan.estado = 'devuelto';
      loan.devuelta_at = new Date();
      return { rowCount: 1, rows: [] };
    }
    if (statement.startsWith("UPDATE notebooks SET estado = 'disponible'")) {
      notebook.estado = 'disponible';
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Consulta no prevista en prueba de flujo: ${statement}`);
  };

  db.transaction = async (callback) => callback({ query: execute });
  db.query = async (sql) => {
    const statement = sql.replace(/\s+/g, ' ').trim();
    if (statement.startsWith('SELECT c.numero,')) return { rowCount: 1, rows: [{ numero: 2, disponibles: 1 }] };
    if (statement.startsWith('SELECT u.email FROM users u')) return { rowCount: 0, rows: [] };
    if (statement.startsWith('SELECT u.email FROM loans l')) return { rowCount: 0, rows: [] };
    if (statement.startsWith('SELECT r.codigo AS id')) return {
      rowCount: reservation ? 1 : 0,
      rows: reservation ? [{
        id: reservation.codigo, tipo: reservation.tipo, carro: reservation.carro, curso: reservation.curso, cantidad: reservation.cantidad,
        retiro_at: reservation.retiro_at, motivo: reservation.motivo, estado: reservation.estado, notebook_ids: [notebook.id]
      }] : []
    };
    if (statement.startsWith('SELECT l.id, n.codigo AS notebook')) return { rowCount: loan ? 1 : 0, rows: loan ? [{ ...loan, devolucion_estado: returnRequest?.estado ?? null }] : [] };
    if (statement.startsWith('SELECT r.id, n.codigo AS notebook')) return { rowCount: returnRequest?.estado === 'pendiente' ? 1 : 0, rows: returnRequest?.estado === 'pendiente' ? [{ id: returnRequest.id, notebook: notebook.codigo }] : [] };
    throw new Error(`Consulta de lectura no prevista en prueba de flujo: ${statement}`);
  };
  authService.authenticate = async (request) => request.headers.authorization === 'Bearer workflow-admin'
    ? { id: '1', rol: 'admin' }
    : user;

  async function apiCall(method, pathname, body, role) {
    const route = routes.resolve(method, pathname);
    assert.ok(route, `${method} ${pathname} debe estar registrada`);
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    request.method = method;
    request.url = pathname;
    request.headers = { authorization: `Bearer workflow-${role}` };
    const response = {
      writeHead(status) { this.status = status; },
      end(serialized) { this.payload = serialized ? JSON.parse(serialized) : null; }
    };
    await controller.handle(request, response, route, {});
    return { status: response.status, payload: response.payload };
  }

  try {
    const availableCars = await apiCall('GET', '/api/carros');
    assert.equal(availableCars.status, 200);
    assert.equal(availableCars.payload.carros[0].disponibles, 1);

    const created = await apiCall('POST', '/api/reservations', {
      tipo: 'individual', cantidad: 1, curso: '6°14°', carro: '2', retiroAt: nextBusinessReservationTime().toISOString(), motivo: 'Práctica'
    }, 'profesor');
    assert.equal(created.status, 201);
    assert.equal(created.payload.reservation.id, reservation.id);
    assert.equal(reservationLink.active, true);

    const listedReservations = await apiCall('GET', '/api/reservations', undefined, 'profesor');
    assert.equal(listedReservations.payload.reservations[0].id, reservation.codigo);

    const checkout = await apiCall('POST', '/api/admin/reservations/77/checkout', {}, 'admin');
    assert.equal(checkout.status, 200);
    assert.equal(checkout.payload.loansCreated, 1);
    assert.equal(reservation.estado, 'retirada');
    assert.equal(reservationLink.active, false);

    const activeLoans = await apiCall('GET', '/api/loans', undefined, 'profesor');
    assert.equal(activeLoans.payload.loans[0].estado, 'activo');
    assert.equal(activeLoans.payload.loans[0].notebook, notebook.codigo);

    await apiCall('POST', '/api/loans/80/return', {}, 'profesor');
    assert.equal((await apiCall('GET', '/api/loans', undefined, 'profesor')).payload.loans[0].estado, 'devolucion_pendiente');
    assert.equal((await apiCall('GET', '/api/admin/returns', undefined, 'admin')).payload.returns[0].id, '90');

    await apiCall('POST', '/api/admin/returns/90/confirm', {}, 'admin');
    const history = await apiCall('GET', '/api/loans', undefined, 'profesor');
    assert.equal(history.payload.loans[0].estado, 'devuelto');
    assert.ok(history.payload.loans[0].devuelta_at);
    assert.equal(notebook.estado, 'disponible');
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
    authService.authenticate = originalAuthenticate;
  }
});
