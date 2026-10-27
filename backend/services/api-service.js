const crypto = require('node:crypto');
const db = require('../data/database');
const { AppError } = require('../errors');
const {
  loanDueAt,
  reservationReturnTimeError
} = require('./business-time');
const { parseBusinessDateTime, reservationTimeError } = require('./business-time');
const {
  requiredText,
  personName,
  accountEmail,
  accountPassword,
  courseDivision,
  numericIdentifier
} = require('./validation');
const { sendMail } = require('./mail-service');

async function notifyByEmail(userId, subject, html) {
  try {
    const result = await db.query(`SELECT u.email FROM users u
      JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id = $1 AND p.email_notifications = TRUE`, [userId]);
    if (!result.rowCount) return;
    await sendMail({ to: result.rows[0].email, subject, html });
  } catch {
    console.error('No se pudo enviar una notificación por correo.');
  }
}

async function notifyLoanReturnByEmail(loanId) {
  try {
    const result = await db.query(`SELECT u.email FROM loans l
      JOIN users u ON u.id = l.user_id
      JOIN user_preferences p ON p.user_id = u.id
      WHERE l.id = $1 AND p.email_notifications = TRUE`, [loanId]);
    if (!result.rowCount) return;
    await sendMail({
      to: result.rows[0].email,
      subject: 'Devolución confirmada',
      html: '<p>La recepción de tu notebook fue confirmada.</p>'
    });
  } catch {
    console.error('No se pudo enviar una notificación por correo.');
  }
}

function requireAdmin(user, message) {
  if (user.rol !== 'admin') throw new AppError(message, 403);
}

function reservationCarroId(value) {
  const match = String(value ?? '').match(/^\s*(?:Carro\s*)?(\d{1,3})\s*$/i);
  return match && Number(match[1]) >= 1 ? String(Number(match[1])) : null;
}

function reservationPayload(body, user) {
  const type = body.tipo || 'individual';
  if (!['individual', 'lote'].includes(type)) throw new AppError('Tipo de reserva inválido', 400);
  const retiroAt = parseBusinessDateTime(body.retiroAt);
  if (!retiroAt) throw new AppError('retiroAt inválido', 400);
  const timeError = reservationTimeError(retiroAt);
  if (timeError) throw new AppError(timeError, 400);
  const horaDevolucion = body.horaDevolucion;
  const horaDevolucionError = reservationReturnTimeError(retiroAt, horaDevolucion);
  if (horaDevolucionError) throw new AppError(horaDevolucionError, 400);
  const quantity = Number(body.cantidad);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 40) throw new AppError('Cantidad inválida', 400);
  if (user.rol === 'alumno' && quantity !== 1) throw new AppError('Los alumnos solo pueden pedir una notebook', 400);
  if (type === 'lote' && user.rol !== 'profesor') throw new AppError('Solo profesores pueden solicitar lotes', 403);
  if (type === 'lote' && (quantity < 3 || quantity > 10)) throw new AppError('Un lote debe tener entre 3 y 10 notebooks', 400);
  if (type === 'individual' && quantity > 2) throw new AppError('Una reserva individual admite como máximo 2 notebooks', 400);
  const curso = user.rol === 'profesor'
    ? courseDivision(body.curso)
    : null;
  let motivo = 'Sin especificar';
  if (body.motivo !== undefined && body.motivo !== null && body.motivo !== '') {
    motivo = requiredText(body.motivo, 'El motivo');
  }
  const carro = requiredText(body.carro, 'El carro');
  if (!/^\d{1,3}$/.test(carro) || Number(carro) < 1) {
    throw new AppError('Seleccioná un carro válido', 400);
  }
  return {
    code: `RES-${Date.now()}`,
    ownerId: user.id,
    type,
    carro: String(Number(carro)),
    curso,
    cantidad: quantity,
    retiroAt,
    horaDevolucion,
    motivo,
    estado: 'pendiente_aprobacion'
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
  async users(_body, user, _params, query) {
    requireAdmin(user, 'Solo admin puede consultar usuarios');
    const role = query?.get('rol');
    if (role && !['alumno', 'profesor'].includes(role)) throw new AppError('Rol de usuario inválido', 400);
    const result = await db.query(`SELECT legajo, nombre, email, rol,
      (baneado AND (baneado_hasta IS NULL OR baneado_hasta > now())) AS baneado,
      baneado_hasta
      FROM users WHERE rol <> 'admin' AND ($1::user_role IS NULL OR rol = $1::user_role)
      ORDER BY nombre`, [role || null]);
    return { users: result.rows };
  },
  async createUser(body, user) {
    requireAdmin(user, 'Solo admin puede crear usuarios');
    const nombre = personName(body.nombre, 'El nombre');
    const apellido = personName(body.apellido, 'El apellido');
    const nombreCompleto = `${nombre} ${apellido}`;
    const email = accountEmail(body.email);
    const legajo = numericIdentifier(body.legajo);
    const password = accountPassword(body.password);
    if (!['alumno', 'profesor'].includes(body.rol)) throw new AppError('Rol inválido', 400);
    try {
      return await db.transaction(async (client) => {
        const inserted = await client.query(`INSERT INTO users (legajo, nombre, email, rol, password_hash, baneado)
          VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')), FALSE)
          RETURNING id, legajo, nombre, email, rol, baneado`, [legajo, nombreCompleto, email, body.rol, password]);
        await client.query(`INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes)
          VALUES ($1, TRUE, 30)`, [inserted.rows[0].id]);
        return { user: inserted.rows[0] };
      });
    } catch (error) {
      if (error.code === '23505') throw new AppError('El email o el legajo ya están registrados', 409);
      throw error;
    }
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
      CASE WHEN n.estado = 'disponible'
        AND EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        THEN 'reservada' ELSE estado::text END AS estado,
      CASE WHEN n.estado = 'disponible'
        AND EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        THEN 'Reservada' ELSE ubicacion END AS ubicacion,
      updated_at AS actualizada, u.nombre AS prestado_a, carro_id
      FROM notebooks n LEFT JOIN users u ON u.id = n.prestado_a ORDER BY codigo`);
    return { notebooks: result.rows };
  },
  async carros(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar carros');
    const result = await db.query('SELECT numero FROM carros ORDER BY numero');
    return { carros: result.rows };
  },
  async availableCarros() {
    const result = await db.query(`SELECT c.numero,
      (SELECT COUNT(*)::integer FROM notebooks n
        WHERE n.carro_id = c.numero AND n.estado = 'disponible'
          AND NOT EXISTS (SELECT 1 FROM reservation_notebooks rn
            WHERE rn.notebook_id = n.id AND rn.active)) AS disponibles
      FROM carros c ORDER BY c.numero`);
    return { carros: result.rows };
  },
  async createCarro(body, user) {
    requireAdmin(user, 'Solo admin puede crear carros');
    const numero = typeof body.numero === 'number' ? body.numero
      : typeof body.numero === 'string' && /^\d{1,3}$/.test(body.numero.trim()) ? Number(body.numero.trim()) : NaN;
    if (!Number.isInteger(numero) || numero < 1 || numero > 999) {
      throw new AppError('El número de carro debe ser un entero entre 1 y 999', 400);
    }
    try {
      const result = await db.query('INSERT INTO carros (numero) VALUES ($1) RETURNING numero', [numero]);
      return { carro: result.rows[0] };
    } catch (error) {
      if (error.code === '23505') throw new AppError('Ya existe un carro con ese número', 409);
      throw error;
    }
  },
  async createNotebooks(body, user) {
    requireAdmin(user, 'Solo admin puede crear notebooks');
    const initialNumber = typeof body.numero === 'string' ? body.numero.trim() : '';
    if (!/^\d{1,3}$/.test(initialNumber)) {
      throw new AppError('El número inicial debe contener de 1 a 3 dígitos', 400);
    }
    const numero = Number(initialNumber);
    const carroId = body.carro_id;
    const cantidad = Number(body.cantidad);
    if (numero < 1 || numero > 999 || numero + cantidad - 1 > 999) {
      throw new AppError('La numeración debe estar entre 1 y 999 y no puede superar 999', 400);
    }
    if (!Number.isInteger(carroId) || carroId < 1 || carroId > 999) {
      throw new AppError('Seleccioná un carro válido', 400);
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) {
      throw new AppError('La cantidad debe ser un entero entre 1 y 10', 400);
    }
    const codes = Array.from({ length: cantidad }, (_value, index) => `NB-${String(numero + index).padStart(3, '0')}`);
    try {
      return await db.transaction(async (client) => {
        const carro = await client.query('SELECT numero FROM carros WHERE numero = $1 FOR SHARE', [carroId]);
        if (!carro.rowCount) throw new AppError('El carro seleccionado no existe', 400);
        const existing = await client.query('SELECT codigo FROM notebooks WHERE codigo = ANY($1::text[])', [codes]);
        if (existing.rowCount) throw new AppError(`Ya existe la notebook ${existing.rows[0].codigo}`, 409);
        const created = [];
        for (const codigo of codes) {
          const result = await client.query(`INSERT INTO notebooks (codigo, estado, ubicacion, carro_id)
            VALUES ($1, 'disponible', $2, $3) RETURNING codigo AS id, estado, ubicacion, carro_id`,
          [codigo, `Carro ${carroId}`, carroId]);
          created.push(result.rows[0]);
        }
        return { notebooks: created };
      });
    } catch (error) {
      if (error.code === '23505') throw new AppError('Una o más notebooks de esa serie ya existen', 409);
      if (error.code === '23503') throw new AppError('El carro seleccionado no existe', 400);
      throw error;
    }
  },
  async updateNotebook(body, user, { code }) {
    requireAdmin(user, 'Solo admin puede cambiar estados');
    if (!['disponible', 'mantenimiento'].includes(body.estado)) {
      throw new AppError('Estado de notebook inválido', 400);
    }
    return db.transaction(async (client) => {
      const current = await client.query('SELECT id, estado FROM notebooks WHERE codigo = $1 FOR UPDATE', [code]);
      if (!current.rowCount) throw new AppError('Notebook no encontrada', 404);
      if (!['disponible', 'mantenimiento'].includes(current.rows[0].estado)) {
        throw new AppError('No se puede cambiar manualmente el estado de una notebook prestada', 409);
      }
      const result = await client.query(`UPDATE notebooks SET estado = $1::notebook_status,
        ubicacion = CASE WHEN $2::text = 'mantenimiento' THEN 'Taller'
          ELSE COALESCE('Carro ' || carro_id::text, ubicacion) END,
        prestado_a = NULL, updated_at = now()
        WHERE id = $3 RETURNING codigo AS id, estado, ubicacion`,
      [body.estado, body.estado, current.rows[0].id]);
      if (body.estado === 'disponible' || body.estado === 'mantenimiento') {
        await client.query('UPDATE reservation_notebooks SET active = FALSE WHERE notebook_id = $1 AND active', [current.rows[0].id]);
      }
      if (body.estado === 'disponible') {
        await client.query("UPDATE tickets SET estado = 'resuelto', resolved_at = now(), resolved_by = $1 WHERE notebook_id = $2 AND estado <> 'resuelto'", [user.id, current.rows[0].id]);
      }
      return { notebook: result.rows[0] };
    });
  },
  async reservations(_body, user) {
    const result = await db.query(`SELECT r.codigo AS id, r.tipo, r.carro, r.curso, r.cantidad,
      r.retiro_at, r.hora_devolucion, r.motivo, r.estado,
      COALESCE(ARRAY_AGG(rn.notebook_id) FILTER (WHERE rn.active), '{}') AS notebook_ids
      FROM reservations r LEFT JOIN reservation_notebooks rn ON rn.reservation_id = r.id
      WHERE r.owner_id = $1 GROUP BY r.id ORDER BY retiro_at`, [user.id]);
    return { reservations: result.rows };
  },
  async createReservation(body, user) {
    const reservation = reservationPayload(body, user);
    const result = await db.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const pending = await client.query(`SELECT 1 FROM loans WHERE user_id = $1 AND estado <> 'devuelto'
        UNION ALL SELECT 1 FROM reservations WHERE owner_id = $1 AND estado IN ('confirmada', 'pendiente_aprobacion', 'aprobada') LIMIT 1`, [user.id]);
      if (pending.rowCount) throw new AppError('No podés solicitar equipos hasta completar la entrega pendiente', 409);
      const selectedCarro = await client.query('SELECT numero FROM carros WHERE numero = $1 FOR SHARE', [Number(reservation.carro)]);
      if (!selectedCarro.rowCount) throw new AppError('El carro seleccionado no existe', 400);
      const available = await client.query(`SELECT n.id FROM notebooks n WHERE n.estado = 'disponible'
        AND n.carro_id = $1
        AND NOT EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
        ORDER BY n.codigo FOR UPDATE SKIP LOCKED LIMIT $2`, [Number(reservation.carro), reservation.cantidad]);
      if (available.rowCount < reservation.cantidad) {
        throw new AppError('No hay suficientes notebooks disponibles en el carro seleccionado', 409);
      }
      const inserted = await client.query(`INSERT INTO reservations
        (codigo, owner_id, tipo, carro, curso, cantidad, retiro_at, hora_devolucion, motivo, estado)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::time, $9, $10)
        RETURNING id, codigo AS id_codigo, tipo, carro, curso, cantidad, retiro_at,
          hora_devolucion, motivo, estado`,
      [reservation.code, reservation.ownerId, reservation.type, reservation.carro, reservation.curso,
        reservation.cantidad, reservation.retiroAt, reservation.horaDevolucion, reservation.motivo, reservation.estado]);
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
    const result = await db.query(`SELECT r.id, r.codigo, r.tipo, r.carro, r.curso, r.cantidad,
      r.retiro_at, r.hora_devolucion, r.motivo, r.estado,
      u.legajo, u.nombre, COUNT(rn.notebook_id)::integer AS equipos_asignados
      FROM reservations r JOIN users u ON u.id = r.owner_id LEFT JOIN reservation_notebooks rn ON rn.reservation_id = r.id AND rn.active
      GROUP BY r.id, u.legajo, u.nombre ORDER BY r.retiro_at`);
    return { reservations: result.rows };
  },
  async approveReservation(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede aprobar reservas');
    const result = await db.transaction(async (client) => {
      const reservation = await client.query(`SELECT id, owner_id, cantidad, carro FROM reservations
        WHERE id = $1 AND estado = 'pendiente_aprobacion' FOR UPDATE`, [id]);
      if (!reservation.rowCount) throw new AppError('Solicitud no encontrada o no pendiente de aprobación', 404);
      const carroId = reservationCarroId(reservation.rows[0].carro);
      await client.query(`UPDATE reservation_notebooks rn SET active = FALSE
        FROM notebooks n WHERE rn.reservation_id = $1 AND rn.active AND n.id = rn.notebook_id
          AND (n.estado <> 'disponible' OR ($2::text IS NOT NULL AND n.carro_id::text <> $2))`,
      [id, carroId]);
      const assigned = await client.query(`SELECT rn.notebook_id FROM reservation_notebooks rn
        JOIN notebooks n ON n.id = rn.notebook_id
        WHERE rn.reservation_id = $1 AND rn.active
          AND ($2::text IS NULL OR n.carro_id::text = $2) FOR UPDATE OF rn`,
      [id, carroId]);
      if (assigned.rowCount < reservation.rows[0].cantidad) {
        const missing = reservation.rows[0].cantidad - assigned.rowCount;
        const available = await client.query(`SELECT n.id FROM notebooks n
          WHERE n.estado = 'disponible'
            AND ($2::text IS NULL OR n.carro_id::text = $2)
            AND NOT EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
          ORDER BY n.codigo FOR UPDATE SKIP LOCKED LIMIT $1`, [missing, carroId]);
        if (available.rowCount < missing) throw new AppError('No hay suficientes notebooks disponibles para completar el lote', 409);
        for (const notebook of available.rows) {
          await client.query(`INSERT INTO reservation_notebooks (reservation_id, notebook_id, active)
            VALUES ($1, $2, TRUE) ON CONFLICT (reservation_id, notebook_id) DO UPDATE SET active = TRUE`,
          [id, notebook.id]);
        }
      }
      await client.query("UPDATE reservations SET estado = 'aprobada' WHERE id = $1", [id]);
      return { message: 'Solicitud aprobada', ownerId: reservation.rows[0].owner_id };
    });
    await notifyByEmail(result.ownerId, 'Reserva confirmada', '<p>Tu solicitud de reserva fue aprobada.</p>');
    return { message: result.message };
  },
  async rejectReservation(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede rechazar reservas');
    return db.transaction(async (client) => {
      const reservation = await client.query(`UPDATE reservations SET estado = 'rechazada'
        WHERE id = $1 AND estado IN ('pendiente_aprobacion', 'aprobada') RETURNING id`, [id]);
      if (!reservation.rowCount) throw new AppError('Solicitud no encontrada o no rechazable', 404);
      await client.query('UPDATE reservation_notebooks SET active = FALSE WHERE reservation_id = $1 AND active', [id]);
      return { message: 'Solicitud rechazada' };
    });
  },
  async checkoutReservation(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede registrar retiros');
    return db.transaction(async (client) => {
      const reservationResult = await client.query(`SELECT id, owner_id, tipo, curso, cantidad,
        retiro_at, hora_devolucion, estado, carro
        FROM reservations WHERE id = $1 AND estado IN ('confirmada', 'aprobada', 'retirada') FOR UPDATE`, [id]);
      if (!reservationResult.rowCount) throw new AppError('Reserva no encontrada o no lista para retiro', 404);
      const reservation = reservationResult.rows[0];
      const carroId = reservationCarroId(reservation.carro);
      const existingLoans = await client.query('SELECT id FROM loans WHERE reservation_id = $1', [id]);
      if (existingLoans.rowCount) return { message: 'El retiro ya estaba registrado', loansCreated: 0 };
      await client.query(`UPDATE reservation_notebooks rn SET active = FALSE
        FROM notebooks n WHERE rn.reservation_id = $1 AND rn.active AND n.id = rn.notebook_id
          AND (n.estado <> 'disponible' OR ($2::text IS NOT NULL AND n.carro_id::text <> $2))`,
      [id, carroId]);
      let notebooks = await client.query(`SELECT n.id, n.codigo FROM reservation_notebooks rn JOIN notebooks n ON n.id = rn.notebook_id
        WHERE rn.reservation_id = $1 AND rn.active
          AND ($2::text IS NULL OR n.carro_id::text = $2) FOR UPDATE OF rn`, [id, carroId]);
      if (notebooks.rowCount < reservation.cantidad) {
        const missing = reservation.cantidad - notebooks.rowCount;
        const available = await client.query(`SELECT n.id, n.codigo FROM notebooks n
          WHERE n.estado = 'disponible'
            AND ($2::text IS NULL OR n.carro_id::text = $2)
            AND NOT EXISTS (SELECT 1 FROM reservation_notebooks rn WHERE rn.notebook_id = n.id AND rn.active)
          ORDER BY n.codigo FOR UPDATE SKIP LOCKED LIMIT $1`, [missing, carroId]);
        if (available.rowCount < missing) {
          throw new AppError('No hay suficientes notebooks disponibles para completar esta reserva', 409);
        }
        for (const notebook of available.rows) {
          await client.query(`INSERT INTO reservation_notebooks (reservation_id, notebook_id, active)
            VALUES ($1, $2, TRUE) ON CONFLICT (reservation_id, notebook_id) DO UPDATE SET active = TRUE`,
          [id, notebook.id]);
        }
        notebooks = { rows: [...notebooks.rows, ...available.rows], rowCount: reservation.cantidad };
      }
      const retiradaAt = new Date();
      const horaDevolucion = reservation.hora_devolucion
        ? String(reservation.hora_devolucion).slice(0, 5)
        : null;
      const venceAt = loanDueAt(retiradaAt, horaDevolucion);
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
      l.devuelta_at, l.estado, r.estado AS devolucion_estado, r.hora_prevista,
      res.hora_devolucion,
      (l.estado = 'activo' AND l.vence_at <= now()) AS vencido FROM loans l
      JOIN notebooks n ON n.id = l.notebook_id LEFT JOIN returns r ON r.loan_id = l.id
      LEFT JOIN reservations res ON res.id = l.reservation_id
      WHERE l.user_id = $1 ORDER BY l.retirada_at DESC`, [user.id]);
    return { loans: result.rows };
  },
  async requestReturn(body, user, { id }) {
    return db.transaction(async (client) => {
      const result = await client.query(`UPDATE loans SET estado = 'devolucion_pendiente'
        WHERE id = $1 AND user_id = $2 AND estado = 'activo' RETURNING id, notebook_id`, [id, user.id]);
      if (!result.rowCount) throw new AppError('Préstamo activo no encontrado', 404);
      await client.query(`INSERT INTO returns (loan_id, hora_prevista)
        VALUES ($1, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::time)
        ON CONFLICT (loan_id) DO NOTHING`, [id]);
      const notebook = await client.query(`UPDATE notebooks SET estado = 'pendiente_devolucion', updated_at = now()
        WHERE id = $1 AND estado = 'prestada' AND prestado_a = $2 RETURNING id`,
      [result.rows[0].notebook_id, user.id]);
      if (!notebook.rowCount) {
        throw new AppError('La notebook ya no figura prestada a este usuario', 409);
      }
      return { message: 'Devolución pendiente de confirmación' };
    });
  },
  async adminReturns(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar devoluciones');
    const result = await db.query(`SELECT r.id, n.codigo AS notebook, u.legajo, u.nombre, l.curso,
      r.solicitado_at, r.hora_prevista, res.hora_devolucion, l.vence_at
      FROM returns r JOIN loans l ON l.id = r.loan_id JOIN notebooks n ON n.id = l.notebook_id
      JOIN users u ON u.id = l.user_id LEFT JOIN reservations res ON res.id = l.reservation_id
      WHERE r.estado = 'pendiente' ORDER BY r.solicitado_at`);
    return { returns: result.rows };
  },
  async adminOpenLoans(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar préstamos no devueltos');
    const result = await db.query(`SELECT l.id, n.codigo AS notebook, u.legajo, u.nombre, u.rol,
      l.curso, l.retirada_at, l.vence_at, l.estado,
      r.id AS return_id, r.solicitado_at, r.hora_prevista
      FROM loans l JOIN notebooks n ON n.id = l.notebook_id
      JOIN users u ON u.id = l.user_id
      LEFT JOIN returns r ON r.loan_id = l.id AND r.estado = 'pendiente'
      WHERE l.estado IN ('activo', 'devolucion_pendiente')
      ORDER BY l.vence_at, l.retirada_at`);
    return { loans: result.rows };
  },
  async confirmReturn(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede confirmar devoluciones');
    const result = await db.transaction(async (client) => {
      const result = await client.query(`UPDATE returns SET estado = 'confirmada', confirmado_at = now(), confirmado_por = $1
        WHERE id = $2 AND estado = 'pendiente' RETURNING loan_id`, [user.id, id]);
      if (!result.rowCount) throw new AppError('Devolución pendiente no encontrada', 404);
      const loanId = result.rows[0].loan_id;
      await client.query("UPDATE loans SET estado = 'devuelto', devuelta_at = now() WHERE id = $1", [loanId]);
      await client.query(`UPDATE notebooks SET estado = 'disponible',
        ubicacion = COALESCE('Carro ' || carro_id::text, ubicacion), prestado_a = NULL, updated_at = now()
        WHERE id = (SELECT notebook_id FROM loans WHERE id = $1)`, [loanId]);
      return { message: 'Devolución confirmada', loanId };
    });
    await notifyLoanReturnByEmail(result.loanId);
    return { message: result.message };
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
    const motivo = requiredText(body.motivo, 'El motivo');
    const descripcion = requiredText(body.descripcion, 'La descripción');
    let notebook = null;
    if (body.notebook !== undefined && body.notebook !== null && body.notebook !== '') {
      notebook = requiredText(body.notebook, 'La notebook');
    }
    return db.transaction(async (client) => {
      let notebookId = null;
      if (notebook) {
        const existing = await client.query('SELECT id FROM notebooks WHERE codigo = $1 FOR UPDATE', [notebook]);
        if (!existing.rowCount) throw new AppError('La notebook seleccionada no existe', 400);
        notebookId = existing.rows[0].id;
      }
      const result = await client.query(`INSERT INTO tickets (codigo, notebook_id, owner_id, motivo, descripcion)
        VALUES ($1, $2, $3, $4, $5) RETURNING codigo AS id, estado`,
      [`TCK-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, notebookId, user.id, motivo, descripcion]);
      if (notebookId) {
        await client.query(`UPDATE notebooks SET estado = CASE WHEN estado = 'disponible' THEN 'mantenimiento' ELSE estado END,
          updated_at = now() WHERE id = $1`, [notebookId]);
      }
      return { ticket: result.rows[0] };
    });
  },
  async updateTicket(body, user, { code }) {
    requireAdmin(user, 'Solo admin puede actualizar tickets');
    if (!['abierto', 'progreso', 'resuelto'].includes(body.estado)) throw new AppError('Estado de ticket inválido', 400);
    return db.transaction(async (client) => {
      const result = await client.query(`UPDATE tickets SET estado = $1::ticket_status,
        resolved_at = CASE WHEN $2::text = 'resuelto' THEN now() ELSE NULL END,
        resolved_by = CASE WHEN $2::text = 'resuelto' THEN $3::bigint ELSE NULL END
        WHERE codigo = $4::text RETURNING codigo AS id, estado, notebook_id`,
      [body.estado, body.estado, user.id, code]);
      if (!result.rowCount) throw new AppError('Ticket no encontrado', 404);
      if (body.estado === 'progreso' && result.rows[0].notebook_id) {
        await client.query(`UPDATE notebooks SET estado = 'mantenimiento',
          ubicacion = 'Taller', updated_at = now()
          WHERE id = $1::bigint AND estado = 'disponible'`, [result.rows[0].notebook_id]);
      }
      if (body.estado === 'resuelto' && result.rows[0].notebook_id) {
        await client.query(`UPDATE notebooks SET estado = 'disponible',
          ubicacion = COALESCE('Carro ' || carro_id::text, ubicacion), prestado_a = NULL, updated_at = now()
          WHERE id = $1::bigint AND estado = 'mantenimiento'
            AND NOT EXISTS (SELECT 1 FROM tickets
              WHERE notebook_id = $1::bigint AND estado IN ('abierto', 'progreso'))`,
        [result.rows[0].notebook_id]);
      }
      return { ticket: { id: result.rows[0].id, estado: result.rows[0].estado } };
    });
  },
  async lateReturns(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar demoras');
    const users = await db.query(`SELECT summary.*, (u.baneado AND (u.baneado_hasta IS NULL OR u.baneado_hasta > now())) AS baneado,
      u.baneado_hasta
      FROM user_late_return_summary summary JOIN users u ON u.id = summary.id
      ORDER BY summary.tardanzas DESC, summary.nombre`);
    const history = await db.query(`SELECT u.nombre, u.rol, u.legajo, n.codigo AS notebook_id,
      lr.returned_at AS fecha FROM late_returns lr JOIN users u ON u.id = lr.user_id
      JOIN notebooks n ON n.id = lr.notebook_id ORDER BY lr.returned_at DESC`);
    return { users: users.rows, history: history.rows };
  },
  async updateUser(body, user, { legajo }) {
    requireAdmin(user, 'Solo admin puede suspender usuarios');
    if (typeof body.baneado !== 'boolean') throw new AppError('El estado de baneo es inválido', 400);
    let duration = null;
    if (body.baneado && body.duracionDias !== undefined && body.duracionDias !== null) {
      duration = Number(body.duracionDias);
      if (![1, 3, 7, 15, 30].includes(duration)) throw new AppError('La duración debe ser 1, 3, 7, 15 o 30 días, o indefinida', 400);
    }
    const result = await db.query(`UPDATE users SET baneado = $1,
      baneado_hasta = CASE WHEN NOT $1 OR $3::integer IS NULL THEN NULL ELSE now() + ($3::text || ' days')::interval END
      WHERE legajo = $2 AND rol <> 'admin'
      RETURNING legajo, nombre, baneado, baneado_hasta`, [body.baneado, legajo, duration]);
    if (!result.rowCount) throw new AppError('Usuario no encontrado o no modificable', 404);
    return { user: result.rows[0] };
  },
  async updateUserRole(body, user, { legajo }) {
    requireAdmin(user, 'Solo admin puede cambiar roles');
    if (!['alumno', 'profesor'].includes(body.rol)) {
      throw new AppError('Rol inválido', 400);
    }
    const result = await db.query(`UPDATE users SET rol = $1 WHERE legajo = $2 AND rol <> 'admin'
      RETURNING legajo, nombre, email, rol`, [body.rol, legajo]);
    if (!result.rowCount) throw new AppError('Usuario no encontrado o no modificable', 404);
    return { user: result.rows[0] };
  }
};

module.exports = actions;
