const crypto = require('node:crypto');
const db = require('../data/database');
const { AppError } = require('../errors');

function requireAdmin(user, message) {
  if (user.rol !== 'admin') throw new AppError(message, 403);
}

function reservationPayload(body, user) {
  const type = body.tipo || 'individual';
  if (!['individual', 'lote'].includes(type)) throw new AppError('Tipo de reserva inválido', 400);
  const retiroAt = new Date(body.retiroAt);
  if (Number.isNaN(retiroAt.getTime())) throw new AppError('retiroAt inválido', 400);
  if (retiroAt.getFullYear() !== new Date().getFullYear()) throw new AppError('La reserva debe ser del año actual', 400);
  const minutes = retiroAt.getHours() * 60 + retiroAt.getMinutes();
  if (!((minutes >= 480 && minutes <= 730) || (minutes >= 810 && minutes <= 1050))) {
    throw new AppError('Solo se pueden hacer reservas de 08:00 a 12:10 y de 13:30 a 17:30', 400);
  }
  const quantity = Number(body.cantidad);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 40) throw new AppError('Cantidad inválida', 400);
  if (user.rol === 'alumno' && quantity !== 1) throw new AppError('Los alumnos solo pueden pedir una notebook', 400);
  if (type === 'lote' && user.rol !== 'profesor') throw new AppError('Solo profesores pueden solicitar lotes', 403);
  if (type === 'lote' && quantity < 3) throw new AppError('Un lote debe tener al menos 3 notebooks', 400);
  if (user.rol === 'profesor' && (!body.curso || !String(body.curso).trim())) throw new AppError('El profesor debe indicar el curso', 400);
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

const actions = {
  async me(_body, user) {
    return { user };
  },
  async professors(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar profesores');
    const result = await db.query("SELECT legajo, nombre, email FROM users WHERE rol = 'profesor' ORDER BY nombre");
    return { professors: result.rows };
  },
  async preferences(_body, user) {
    const result = await db.query('SELECT email_notifications AS email, return_reminder_minutes AS recordatorio FROM user_preferences WHERE user_id = $1', [user.id]);
    return { preferences: result.rows[0] || { email: true, recordatorio: 30 } };
  },
  async updatePreferences(body, user) {
    const recordatorio = Number(body.recordatorio);
    if (![0, 15, 30, 60].includes(recordatorio)) throw new AppError('Recordatorio inválido', 400);
    const result = await db.query(`INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes) VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET email_notifications = EXCLUDED.email_notifications, return_reminder_minutes = EXCLUDED.return_reminder_minutes, updated_at = now()
      RETURNING email_notifications AS email, return_reminder_minutes AS recordatorio`, [user.id, Boolean(body.email), recordatorio]);
    return { preferences: result.rows[0] };
  },
  async notebooks() {
    const result = await db.query(`SELECT codigo AS id,
      CASE WHEN EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        THEN 'reservada' ELSE estado::text END AS estado,
      CASE WHEN EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        THEN 'Reservada' ELSE ubicacion END AS ubicacion,
      updated_at AS actualizada, u.nombre AS prestado_a
      FROM notebooks n LEFT JOIN users u ON u.id = n.prestado_a ORDER BY codigo`);
    return { notebooks: result.rows };
  },
  async updateNotebook(body, user, { code }) {
    requireAdmin(user, 'Solo admin puede cambiar estados');
    if (!['disponible', 'prestada', 'mantenimiento', 'pendiente_devolucion'].includes(body.estado)) {
      throw new AppError('Estado de notebook inválido', 400);
    }
    const result = await db.query(`UPDATE notebooks SET estado = $1,
      ubicacion = CASE WHEN $1 = 'mantenimiento' THEN 'Taller' WHEN $1 = 'disponible' THEN 'Carro 1' ELSE ubicacion END,
      prestado_a = CASE WHEN $1 IN ('disponible', 'mantenimiento') THEN NULL ELSE prestado_a END,
      updated_at = now() WHERE codigo = $2 RETURNING codigo AS id, estado, ubicacion`, [body.estado, code]);
    if (!result.rowCount) throw new AppError('Notebook no encontrada', 404);
    if (body.estado === 'disponible' || body.estado === 'mantenimiento') {
      await db.query('UPDATE reservation_notebooks SET active = FALSE WHERE notebook_id = (SELECT id FROM notebooks WHERE codigo = $1) AND active', [code]);
    }
    if (body.estado === 'disponible') {
      await db.query("UPDATE tickets SET estado = 'resuelto', resolved_at = now(), resolved_by = $1 WHERE notebook_id = (SELECT id FROM notebooks WHERE codigo = $2) AND estado <> 'resuelto'", [user.id, code]);
    }
    return { notebook: result.rows[0] };
  },
  async reservations(_body, user) {
    const result = await db.query(`SELECT r.codigo AS id, r.tipo, r.carro, r.curso, r.cantidad, r.retiro_at, r.motivo, r.estado,
      COALESCE(ARRAY_AGG(rn.notebook_id) FILTER (WHERE rn.active), '{}') AS notebook_ids
      FROM reservations r LEFT JOIN reservation_notebooks rn ON rn.reservation_id = r.id
      WHERE r.owner_id = $1 GROUP BY r.id ORDER BY retiro_at`, [user.id]);
    return { reservations: result.rows };
  },
  async createReservation(body, user) {
    const reservation = reservationPayload(body, user);
    const result = await db.transaction(async (client) => {
      const pending = await client.query(`SELECT 1 FROM loans WHERE user_id = $1 AND estado <> 'devuelto'
        UNION ALL SELECT 1 FROM reservations WHERE owner_id = $1 AND estado IN ('confirmada', 'pendiente_aprobacion', 'aprobada') LIMIT 1`, [user.id]);
      if (pending.rowCount) throw new AppError('No podés solicitar equipos hasta completar la entrega pendiente', 409);
      const available = await client.query(`SELECT n.id FROM notebooks n WHERE n.estado = 'disponible'
        AND NOT EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        ORDER BY n.codigo FOR UPDATE SKIP LOCKED LIMIT $1`, [reservation.cantidad]);
      if (available.rowCount < reservation.cantidad) throw new AppError('No hay suficientes notebooks disponibles', 409);
      const inserted = await client.query(`INSERT INTO reservations (codigo, owner_id, tipo, carro, curso, cantidad, retiro_at, motivo, estado)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, codigo AS id_codigo, tipo, carro, curso, cantidad, retiro_at, motivo, estado`, Object.values(reservation));
      for (const notebook of available.rows) {
        await client.query('INSERT INTO reservation_notebooks (reservation_id, notebook_id, active) VALUES ($1, $2, TRUE)', [inserted.rows[0].id, notebook.id]);
      }
      return { reservation: inserted.rows[0] };
    });
    return result;
  },
  async cancelReservation(_body, user, { code }) {
    const result = await db.transaction(async (client) => {
      const reservation = await client.query(`UPDATE reservations SET estado = 'cancelada'
        WHERE codigo = $1 AND owner_id = $2 AND estado IN ('confirmada', 'pendiente_aprobacion') RETURNING id`, [code, user.id]);
      if (!reservation.rowCount) throw new AppError('Reserva no encontrada o no cancelable', 404);
      await client.query('UPDATE reservation_notebooks SET active = FALSE WHERE reservation_id = $1 AND active', [reservation.rows[0].id]);
      return { message: 'Reserva cancelada' };
    });
    return result;
  },
  async adminReservations(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar reservas');
    const result = await db.query(`SELECT r.id, r.codigo, r.tipo, r.curso, r.cantidad, r.retiro_at, r.motivo, r.estado,
      u.legajo, u.nombre, COUNT(rn.notebook_id)::integer AS equipos_asignados
      FROM reservations r JOIN users u ON u.id = r.owner_id LEFT JOIN reservation_notebooks rn ON rn.reservation_id = r.id AND rn.active
      GROUP BY r.id, u.legajo, u.nombre ORDER BY r.retiro_at`);
    return { reservations: result.rows };
  },
  async approveReservation(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede aprobar reservas');
    const result = await db.query(`UPDATE reservations SET estado = 'aprobada'
      WHERE id = $1 AND tipo = 'lote' AND estado = 'pendiente_aprobacion' RETURNING owner_id`, [id]);
    if (!result.rowCount) throw new AppError('Solicitud de lote no encontrada', 404);
    return { message: 'Lote aprobado' };
  },
  async checkoutReservation(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede registrar retiros');
    return db.transaction(async (client) => {
      const reservationResult = await client.query(`SELECT id, owner_id, tipo, curso, cantidad, retiro_at, estado
        FROM reservations WHERE id = $1 AND estado IN ('confirmada', 'aprobada', 'retirada') FOR UPDATE`, [id]);
      if (!reservationResult.rowCount) throw new AppError('Reserva no encontrada o no lista para retiro', 404);
      const reservation = reservationResult.rows[0];
      const existingLoans = await client.query('SELECT id FROM loans WHERE reservation_id = $1', [id]);
      if (existingLoans.rowCount) return { message: 'El retiro ya estaba registrado', loansCreated: 0 };
      const notebooks = await client.query(`SELECT n.id, n.codigo FROM reservation_notebooks rn JOIN notebooks n ON n.id = rn.notebook_id
        WHERE rn.reservation_id = $1 AND rn.active FOR UPDATE`, [id]);
      if (notebooks.rowCount !== reservation.cantidad) throw new AppError('La reserva no tiene todos los equipos asignados', 409);
      const retiradaAt = new Date();
      const venceAt = new Date(retiradaAt.getTime() + 8 * 60 * 60 * 1000);
      for (const notebook of notebooks.rows) {
        await client.query(`INSERT INTO loans (notebook_id, user_id, reservation_id, curso, retirada_at, vence_at, estado)
          VALUES ($1, $2, $3, $4, $5, $6, 'activo')`, [notebook.id, reservation.owner_id, id, reservation.curso, retiradaAt, venceAt]);
        await client.query("UPDATE notebooks SET estado = 'prestada', ubicacion = '—', prestado_a = $1, updated_at = now() WHERE id = $2", [reservation.owner_id, notebook.id]);
      }
      await client.query('UPDATE reservation_notebooks SET active = FALSE WHERE reservation_id = $1', [id]);
      await client.query("UPDATE reservations SET estado = 'retirada' WHERE id = $1", [id]);
      return { message: 'Retiro registrado', loansCreated: notebooks.rowCount };
    });
  },
  async loans(_body, user) {
    const result = await db.query(`SELECT l.id, n.codigo AS notebook, l.curso, l.retirada_at, l.vence_at,
      l.devuelta_at, l.estado, r.estado AS devolucion_estado FROM loans l
      JOIN notebooks n ON n.id = l.notebook_id LEFT JOIN returns r ON r.loan_id = l.id
      WHERE l.user_id = $1 ORDER BY l.retirada_at DESC`, [user.id]);
    return { loans: result.rows };
  },
  async requestReturn(_body, user, { id }) {
    const result = await db.query(`UPDATE loans SET estado = 'devolucion_pendiente'
      WHERE id = $1 AND user_id = $2 AND estado = 'activo' RETURNING id`, [id, user.id]);
    if (!result.rowCount) throw new AppError('Préstamo activo no encontrado', 404);
    await db.query("INSERT INTO returns (loan_id) VALUES ($1) ON CONFLICT (loan_id) DO NOTHING", [id]);
    await db.query("UPDATE notebooks SET estado = 'pendiente_devolucion', updated_at = now() WHERE id = (SELECT notebook_id FROM loans WHERE id = $1)", [id]);
    return { message: 'Devolución pendiente de confirmación' };
  },
  async adminReturns(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar devoluciones');
    const result = await db.query(`SELECT r.id, n.codigo AS notebook, u.legajo, u.nombre, l.curso, r.solicitado_at, l.vence_at
      FROM returns r JOIN loans l ON l.id = r.loan_id JOIN notebooks n ON n.id = l.notebook_id
      JOIN users u ON u.id = l.user_id WHERE r.estado = 'pendiente' ORDER BY r.solicitado_at`);
    return { returns: result.rows };
  },
  async confirmReturn(_body, user, { id }) {
    return db.transaction(async (client) => {
      const result = await client.query(`UPDATE returns SET estado = 'confirmada', confirmado_at = now(), confirmado_por = $1
        WHERE id = $2 AND estado = 'pendiente' RETURNING loan_id`, [user.id, id]);
      if (!result.rowCount) throw new AppError('Devolución pendiente no encontrada', 404);
      const loanId = result.rows[0].loan_id;
      await client.query("UPDATE loans SET estado = 'devuelto', devuelta_at = now() WHERE id = $1", [loanId]);
      await client.query("UPDATE notebooks SET estado = 'disponible', ubicacion = 'Carro 1', prestado_a = NULL, updated_at = now() WHERE id = (SELECT notebook_id FROM loans WHERE id = $1)", [loanId]);
      return { message: 'Devolución confirmada' };
    });
  },
  async tickets(_body, user) {
    const result = await db.query(`SELECT t.codigo AS id, n.codigo AS notebook, t.motivo, t.descripcion, t.estado, t.created_at
      FROM tickets t LEFT JOIN notebooks n ON n.id = t.notebook_id WHERE t.owner_id = $1 ORDER BY t.created_at DESC`, [user.id]);
    return { tickets: result.rows };
  },
  async adminTickets(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar tickets');
    const result = await db.query(`SELECT t.codigo AS id, n.codigo AS notebook, t.motivo, t.descripcion, t.estado, t.created_at,
      u.nombre AS owner_nombre, u.rol AS owner_rol FROM tickets t LEFT JOIN notebooks n ON n.id = t.notebook_id
      JOIN users u ON u.id = t.owner_id ORDER BY t.created_at DESC`);
    return { tickets: result.rows };
  },
  async createTicket(body, user) {
    if (!String(body.motivo || '').trim() || !String(body.descripcion || '').trim()) {
      throw new AppError('Motivo y descripción son obligatorios', 400);
    }
    if (String(body.motivo).length > 240) throw new AppError('El motivo no puede superar 240 caracteres', 400);
    const result = await db.query(`INSERT INTO tickets (codigo, notebook_id, owner_id, motivo, descripcion)
      VALUES ($1, (SELECT id FROM notebooks WHERE codigo = $2), $3, $4, $5) RETURNING codigo AS id, estado`,
    [`TCK-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, body.notebook, user.id, body.motivo, body.descripcion]);
    if (body.notebook) {
      await db.query("UPDATE notebooks SET estado = CASE WHEN estado = 'disponible' THEN 'mantenimiento' ELSE estado END, updated_at = now() WHERE codigo = $1", [body.notebook]);
    }
    return { ticket: result.rows[0] };
  },
  async updateTicket(body, user, { code }) {
    requireAdmin(user, 'Solo admin puede actualizar tickets');
    if (!['abierto', 'progreso', 'resuelto'].includes(body.estado)) throw new AppError('Estado de ticket inválido', 400);
    const result = await db.query(`UPDATE tickets SET estado = $1, resolved_at = CASE WHEN $1 = 'resuelto' THEN now() ELSE NULL END,
      resolved_by = CASE WHEN $1 = 'resuelto' THEN $2 ELSE NULL END WHERE codigo = $3 RETURNING codigo AS id, estado`,
    [body.estado, user.id, code]);
    if (!result.rowCount) throw new AppError('Ticket no encontrado', 404);
    if (body.estado === 'resuelto') {
      await db.query("UPDATE notebooks SET estado = 'disponible', ubicacion = 'Carro 1', updated_at = now() WHERE id = (SELECT notebook_id FROM tickets WHERE codigo = $1) AND estado = 'mantenimiento'", [code]);
    }
    return { ticket: result.rows[0] };
  },
  async lateReturns(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar demoras');
    const result = await db.query(`SELECT summary.*, users.baneado FROM user_late_return_summary summary
      JOIN users ON users.id = summary.id ORDER BY summary.tardanzas DESC, summary.nombre`);
    return { users: result.rows };
  },
  async updateUser(body, user, { legajo }) {
    requireAdmin(user, 'Solo admin puede suspender usuarios');
    const result = await db.query(`UPDATE users SET baneado = $1 WHERE legajo = $2 AND rol <> 'admin'
      RETURNING legajo, nombre, baneado`, [Boolean(body.baneado), legajo]);
    if (!result.rowCount) throw new AppError('Usuario no encontrado o no modificable', 404);
    return { user: result.rows[0] };
  }
};

module.exports = actions;
