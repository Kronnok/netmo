const http = require('node:http');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const port = Number(process.env.PORT || 3000);
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.POSTGRES_DB || 'netmo',
  user: process.env.POSTGRES_USER || 'netmo',
  password: process.env.POSTGRES_PASSWORD
});
const sessions = new Map();

function send(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function tokenFor(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, user);
  return token;
}

async function authenticated(request, requiredRole) {
  const token = request.headers.authorization?.replace('Bearer ', '');
  const userId = token ? sessions.get(token) : null;
  if (!userId) throw Object.assign(new Error('No autenticado'), { status: 401 });
  const result = await pool.query('SELECT id, legajo, nombre, email, curso, rol, baneado FROM users WHERE id = $1', [userId]);
  const user = result.rows[0];
  if (!user || user.baneado) throw Object.assign(new Error('Cuenta no autorizada'), { status: 403 });
  if (requiredRole && user.rol !== requiredRole) throw Object.assign(new Error('Permisos insuficientes'), { status: 403 });
  return user;
}

function reservationPayload(body, user) {
  const type = body.tipo || 'individual';
  const retiroAt = new Date(body.retiroAt);
  if (Number.isNaN(retiroAt.getTime())) throw Object.assign(new Error('retiroAt inválido'), { status: 400 });
  if (retiroAt.getFullYear() !== new Date().getFullYear()) throw Object.assign(new Error('La reserva debe ser del año actual'), { status: 400 });
  const quantity = Number(body.cantidad);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 40) throw Object.assign(new Error('Cantidad inválida'), { status: 400 });
  if (user.rol === 'alumno' && quantity !== 1) throw Object.assign(new Error('Los alumnos solo pueden pedir una notebook'), { status: 400 });
  if (type === 'lote' && user.rol !== 'profesor') throw Object.assign(new Error('Solo profesores pueden solicitar lotes'), { status: 403 });
  if (type === 'lote' && quantity < 3) throw Object.assign(new Error('Un lote debe tener al menos 3 notebooks'), { status: 400 });
  if (user.rol === 'profesor' && (!body.curso || !String(body.curso).trim())) throw Object.assign(new Error('El profesor debe indicar el curso'), { status: 400 });
  return {
    code: `RES-${Date.now()}`,
    ownerId: user.id,
    type,
    carro: body.carro || null,
    curso: user.rol === 'profesor' ? String(body.curso).trim() : null,
    cantidad: quantity,
    retiroAt,
    motivo: body.motivo || 'Sin especificar',
    estado: type === 'lote' ? 'pendiente_aprobacion' : 'confirmada'
  };
}

async function route(request, response) {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host}`);
  const body = ['POST', 'PATCH'].includes(request.method) ? await readBody(request) : {};

  if (request.method === 'GET' && url.pathname === '/health') {
    await pool.query('SELECT 1');
    return send(response, 200, { ok: true, service: 'netmo-api' });
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const result = await pool.query('SELECT id, legajo, nombre, email, curso, rol, baneado FROM users WHERE email = $1 AND password_hash = crypt($2, password_hash)', [body.email, body.password]);
    const user = result.rows[0];
    if (!user) return send(response, 401, { error: 'Correo o contraseña incorrectos' });
    if (user.baneado) return send(response, 403, { error: 'Usuario bloqueado por administración' });
    return send(response, 200, { token: tokenFor(user.id), user });
  }

  const user = await authenticated(request);
  if (request.method === 'GET' && url.pathname === '/api/me') return send(response, 200, { user });
  if (request.method === 'GET' && url.pathname === '/api/preferences') {
    const result = await pool.query('SELECT email_notifications AS email, return_reminder_minutes AS recordatorio FROM user_preferences WHERE user_id = $1', [user.id]);
    return send(response, 200, { preferences: result.rows[0] || { email: true, recordatorio: 30 } });
  }
  if (request.method === 'PATCH' && url.pathname === '/api/preferences') {
    const result = await pool.query(`INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes) VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET email_notifications = EXCLUDED.email_notifications, return_reminder_minutes = EXCLUDED.return_reminder_minutes, updated_at = now()
      RETURNING email_notifications AS email, return_reminder_minutes AS recordatorio`, [user.id, Boolean(body.email), Number(body.recordatorio)]);
    return send(response, 200, { preferences: result.rows[0] });
  }
  if (request.method === 'GET' && url.pathname === '/api/notebooks') {
    const result = await pool.query(`SELECT codigo AS id,
      CASE WHEN EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        THEN 'reservada' ELSE estado::text END AS estado,
      CASE WHEN EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        THEN 'Reservada' ELSE ubicacion END AS ubicacion,
      updated_at AS actualizada, u.nombre AS prestado_a
      FROM notebooks n LEFT JOIN users u ON u.id = n.prestado_a ORDER BY codigo`);
    return send(response, 200, { notebooks: result.rows });
  }
  if (request.method === 'PATCH' && url.pathname.startsWith('/api/notebooks/')) {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede cambiar estados' });
    const code = decodeURIComponent(url.pathname.split('/').pop());
    const result = await pool.query('UPDATE notebooks SET estado = $1, ubicacion = CASE WHEN $1 = \'mantenimiento\' THEN \'Taller\' WHEN $1 = \'disponible\' THEN \'Carro 1\' ELSE ubicacion END, prestado_a = CASE WHEN $1 IN (\'disponible\', \'mantenimiento\') THEN NULL ELSE prestado_a END, updated_at = now() WHERE codigo = $2 RETURNING codigo AS id, estado, ubicacion', [body.estado, code]);
    if (!result.rowCount) return send(response, 404, { error: 'Notebook no encontrada' });
    if (body.estado === 'disponible' || body.estado === 'mantenimiento') await pool.query('UPDATE reservation_notebooks SET active = FALSE WHERE notebook_id = (SELECT id FROM notebooks WHERE codigo = $1) AND active', [code]);
    if (body.estado === 'disponible') await pool.query("UPDATE tickets SET estado = 'resuelto', resolved_at = now(), resolved_by = $1 WHERE notebook_id = (SELECT id FROM notebooks WHERE codigo = $2) AND estado <> 'resuelto'", [user.id, code]);
    return send(response, 200, { notebook: result.rows[0] });
  }
  if (request.method === 'GET' && url.pathname === '/api/reservations') {
    const result = await pool.query(`SELECT r.codigo AS id, r.tipo, r.carro, r.curso, r.cantidad, r.retiro_at, r.motivo, r.estado,
      COALESCE(ARRAY_AGG(rn.notebook_id) FILTER (WHERE rn.active), '{}') AS notebook_ids
      FROM reservations r LEFT JOIN reservation_notebooks rn ON rn.reservation_id = r.id
      WHERE r.owner_id = $1 GROUP BY r.id ORDER BY retiro_at`, [user.id]);
    return send(response, 200, { reservations: result.rows });
  }
  if (request.method === 'POST' && url.pathname === '/api/reservations') {
    const reservation = reservationPayload(body, user);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query(`SELECT 1 FROM loans WHERE user_id = $1 AND estado <> 'devuelto'
        UNION ALL
        SELECT 1 FROM reservations WHERE owner_id = $1 AND estado IN ('confirmada', 'pendiente_aprobacion', 'aprobada')
        LIMIT 1`, [user.id]);
      if (pending.rowCount) throw Object.assign(new Error('No podés solicitar equipos hasta completar la entrega pendiente'), { status: 409 });

      const available = await client.query(`SELECT n.id FROM notebooks n
        WHERE n.estado = 'disponible'
          AND NOT EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        ORDER BY n.codigo FOR UPDATE SKIP LOCKED LIMIT $1`, [reservation.cantidad]);
      if (available.rowCount < reservation.cantidad) throw Object.assign(new Error('No hay suficientes notebooks disponibles'), { status: 409 });

      const result = await client.query(`INSERT INTO reservations (codigo, owner_id, tipo, carro, curso, cantidad, retiro_at, motivo, estado)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, codigo AS id_codigo, tipo, carro, curso, cantidad, retiro_at, motivo, estado`, Object.values(reservation));
      const reservationId = result.rows[0].id;
      for (const notebook of available.rows) {
        await client.query('INSERT INTO reservation_notebooks (reservation_id, notebook_id) VALUES ($1, $2)', [reservationId, notebook.id]);
      }
      await client.query('COMMIT');
      return send(response, 201, { reservation: { ...result.rows[0], id: result.rows[0].id_codigo } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  if (request.method === 'DELETE' && url.pathname.match(/^\/api\/reservations\/[^/]+$/)) {
    const reservationCode = decodeURIComponent(url.pathname.split('/').pop());
    const result = await pool.query(`UPDATE reservations SET estado = 'cancelada'
      WHERE codigo = $1 AND owner_id = $2 AND estado IN ('confirmada', 'pendiente_aprobacion') RETURNING id`, [reservationCode, user.id]);
    if (!result.rowCount) return send(response, 404, { error: 'Reserva no encontrada o no cancelable' });
    await pool.query('UPDATE reservation_notebooks SET active = FALSE WHERE reservation_id = $1 AND active', [reservationId]);
    return send(response, 200, { message: 'Reserva cancelada' });
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/reservations') {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede consultar reservas' });
    const result = await pool.query(`SELECT r.id, r.codigo, r.tipo, r.curso, r.cantidad, r.retiro_at, r.motivo, r.estado,
      u.legajo, u.nombre, COUNT(rn.notebook_id)::integer AS equipos_asignados
      FROM reservations r JOIN users u ON u.id = r.owner_id LEFT JOIN reservation_notebooks rn ON rn.reservation_id = r.id AND rn.active
      GROUP BY r.id, u.legajo, u.nombre ORDER BY r.retiro_at`);
    return send(response, 200, { reservations: result.rows });
  }
  if (request.method === 'POST' && url.pathname.match(/^\/api\/admin\/reservations\/\d+\/approve$/)) {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede aprobar reservas' });
    const reservationId = Number(url.pathname.split('/')[4]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE reservations SET estado = 'aprobada'
        WHERE id = $1 AND tipo = 'lote' AND estado = 'pendiente_aprobacion' RETURNING owner_id`, [reservationId]);
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return send(response, 404, { error: 'Solicitud de lote no encontrada' });
      }
      await client.query(`UPDATE notebooks SET estado = 'prestada', ubicacion = '—', prestado_a = $1, updated_at = now()
        WHERE id IN (SELECT notebook_id FROM reservation_notebooks WHERE reservation_id = $2 AND active)`, [result.rows[0].owner_id, reservationId]);
      await client.query('UPDATE reservation_notebooks SET active = FALSE WHERE reservation_id = $1', [reservationId]);
      await client.query('COMMIT');
      return send(response, 200, { message: 'Lote aprobado' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/loans') {
    const result = await pool.query(`SELECT l.id, n.codigo AS notebook, l.retirada_at, l.vence_at, l.estado, r.estado AS devolucion_estado
      FROM loans l JOIN notebooks n ON n.id = l.notebook_id LEFT JOIN returns r ON r.loan_id = l.id WHERE l.user_id = $1 AND l.estado <> 'devuelto'`, [user.id]);
    return send(response, 200, { loans: result.rows });
  }
  if (request.method === 'POST' && url.pathname.match(/^\/api\/loans\/\d+\/return$/)) {
    const loanId = Number(url.pathname.split('/')[3]);
    const result = await pool.query(`UPDATE loans SET estado = 'devolucion_pendiente' WHERE id = $1 AND user_id = $2 AND estado = 'activo' RETURNING id`, [loanId, user.id]);
    if (!result.rowCount) return send(response, 404, { error: 'Préstamo activo no encontrado' });
    await pool.query("INSERT INTO returns (loan_id) VALUES ($1) ON CONFLICT (loan_id) DO NOTHING", [loanId]);
    await pool.query("UPDATE notebooks SET estado = 'pendiente_devolucion', updated_at = now() WHERE id = (SELECT notebook_id FROM loans WHERE id = $1)", [loanId]);
    return send(response, 202, { message: 'Devolución pendiente de confirmación' });
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/returns') {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede consultar devoluciones' });
    const result = await pool.query(`SELECT r.id, n.codigo AS notebook, u.legajo, u.nombre, u.curso,
        r.solicitado_at, l.vence_at
      FROM returns r JOIN loans l ON l.id = r.loan_id
      JOIN notebooks n ON n.id = l.notebook_id JOIN users u ON u.id = l.user_id
      WHERE r.estado = 'pendiente' ORDER BY r.solicitado_at`);
    return send(response, 200, { returns: result.rows });
  }
  if (request.method === 'POST' && url.pathname.match(/^\/api\/admin\/returns\/\d+\/confirm$/)) {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede confirmar devoluciones' });
    const returnId = Number(url.pathname.split('/')[4]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE returns SET estado = 'confirmada', confirmado_at = now(), confirmado_por = $1
        WHERE id = $2 AND estado = 'pendiente' RETURNING loan_id`, [user.id, returnId]);
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return send(response, 404, { error: 'Devolución pendiente no encontrada' });
      }
      await client.query("UPDATE loans SET estado = 'devuelto', devuelta_at = now() WHERE id = $1", [result.rows[0].loan_id]);
      await client.query("UPDATE notebooks SET estado = 'disponible', ubicacion = 'Carro 1', prestado_a = NULL, updated_at = now() WHERE id = (SELECT notebook_id FROM loans WHERE id = $1)", [result.rows[0].loan_id]);
      await client.query('COMMIT');
      return send(response, 200, { message: 'Devolución confirmada' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/tickets') {
    const result = await pool.query(`SELECT t.codigo AS id, n.codigo AS notebook, t.motivo, t.descripcion, t.estado, t.created_at FROM tickets t LEFT JOIN notebooks n ON n.id = t.notebook_id WHERE t.owner_id = $1 ORDER BY t.created_at DESC`, [user.id]);
    return send(response, 200, { tickets: result.rows });
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/tickets') {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede consultar tickets' });
    const result = await pool.query(`SELECT t.codigo AS id, n.codigo AS notebook, t.motivo, t.descripcion,
      t.estado, t.created_at, u.nombre AS owner_nombre, u.rol AS owner_rol
      FROM tickets t LEFT JOIN notebooks n ON n.id = t.notebook_id JOIN users u ON u.id = t.owner_id
      ORDER BY t.created_at DESC`);
    return send(response, 200, { tickets: result.rows });
  }
  if (request.method === 'POST' && url.pathname === '/api/tickets') {
    const result = await pool.query(`INSERT INTO tickets (codigo, notebook_id, owner_id, motivo, descripcion) VALUES ($1, (SELECT id FROM notebooks WHERE codigo = $2), $3, $4, $5) RETURNING codigo AS id, estado`, [`TCK-${Date.now()}`, body.notebook, user.id, body.motivo, body.descripcion]);
    if (body.notebook) await pool.query("UPDATE notebooks SET estado = CASE WHEN estado = 'disponible' THEN 'mantenimiento' ELSE estado END, updated_at = now() WHERE codigo = $1", [body.notebook]);
    return send(response, 201, { ticket: result.rows[0] });
  }
  if (request.method === 'PATCH' && url.pathname.startsWith('/api/tickets/')) {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede actualizar tickets' });
    const code = decodeURIComponent(url.pathname.split('/').pop());
    const result = await pool.query("UPDATE tickets SET estado = $1, resolved_at = CASE WHEN $1 = 'resuelto' THEN now() ELSE NULL END, resolved_by = CASE WHEN $1 = 'resuelto' THEN $2 ELSE NULL END WHERE codigo = $3 RETURNING codigo AS id, estado", [body.estado, user.id, code]);
    if (!result.rowCount) return send(response, 404, { error: 'Ticket no encontrado' });
    if (body.estado === 'resuelto') await pool.query("UPDATE notebooks SET estado = 'disponible', ubicacion = 'Carro 1', updated_at = now() WHERE id = (SELECT notebook_id FROM tickets WHERE codigo = $1) AND estado = 'mantenimiento'", [code]);
    return send(response, 200, { ticket: result.rows[0] });
  }
  if (request.method === 'GET' && url.pathname === '/api/admin/late-returns') {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede consultar demoras' });
    const result = await pool.query('SELECT * FROM user_late_return_summary ORDER BY tardanzas DESC, nombre');
    return send(response, 200, { users: result.rows });
  }
  if (request.method === 'PATCH' && url.pathname.startsWith('/api/admin/users/')) {
    if (user.rol !== 'admin') return send(response, 403, { error: 'Solo admin puede suspender usuarios' });
    const legajo = decodeURIComponent(url.pathname.split('/').pop());
    const result = await pool.query('UPDATE users SET baneado = $1 WHERE legajo = $2 AND rol <> \'admin\' RETURNING legajo, nombre, baneado', [Boolean(body.baneado), legajo]);
    if (!result.rowCount) return send(response, 404, { error: 'Usuario no encontrado o no modificable' });
    return send(response, 200, { user: result.rows[0] });
  }
  return send(response, 404, { error: 'Ruta no encontrada' });
}

const server = http.createServer((request, response) => {
  route(request, response).catch(error => send(response, error.status || 500, { error: error.message }));
});
server.listen(port, '0.0.0.0', () => console.log(`NetMO API escuchando en ${port}`));
