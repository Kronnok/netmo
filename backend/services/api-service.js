const crypto = require('node:crypto');
const db = require('../data/database');
const config = require('../config');
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
  dniIdentifier
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
      subject: 'Devolución registrada',
      html: '<p>Devolución registrada. La recepción de tu notebook fue confirmada.</p>'
    });
  } catch {
    console.error('No se pudo enviar una notificación por correo.');
  }
}

async function notifyLoanCheckoutByEmail(userId, notebook, dueAt) {
  try {
    const dueTime = new Date(dueAt).toLocaleTimeString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      hour: '2-digit',
      minute: '2-digit'
    });
    await notifyByEmail(
      userId,
      'Notebook entregada',
      `<p>Notebook ${escapeEmailHtml(notebook)} entregada, devolvela antes de ${dueTime}.</p>`
    );
  } catch {
    console.error('No se pudo enviar una notificación por correo.');
  }
}

function searchPattern(value) {
  const normalized = value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return `%${normalized.replace(/[\\%_]/g, '\\$&')}%`;
}

function searchText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > 50) throw new AppError('La búsqueda no puede superar 50 caracteres', 400);
  return text;
}

function matchesSearchSql(placeholder = '$1') {
  const normalize = (column) => `translate(lower(coalesce(${column}, '')), 'áéíóúüñàèìòùäëïöüç', 'aeiouunaeiouaeiouc')`;
  return `(${normalize('u.nombre')} LIKE ${placeholder} ESCAPE '\\'
    OR ${normalize('u.email::text')} LIKE ${placeholder} ESCAPE '\\'
    OR ${normalize('u.dni')} LIKE ${placeholder} ESCAPE '\\'
    OR ${normalize('n.codigo')} LIKE ${placeholder} ESCAPE '\\')`;
}

function minutesUntil(dueAt, now = new Date()) {
  return Math.max(0, Math.ceil((new Date(dueAt).getTime() - now.getTime()) / 60_000));
}

async function runReturnReminders(now) {
  let sent = 0;
  await db.transaction(async (client) => {
    const selected = await client.query(`SELECT l.id, l.user_id, u.email, n.codigo AS notebook, l.vence_at
      FROM loans l JOIN notebooks n ON n.id = l.notebook_id
      JOIN users u ON u.id = l.user_id
      JOIN user_preferences p ON p.user_id = l.user_id
      WHERE l.estado = 'activo' AND l.reminder_sent_at IS NULL
        AND p.email_notifications = TRUE AND p.return_reminder_minutes > 0
        AND l.vence_at > $1
        AND l.vence_at <= $1 + make_interval(mins => p.return_reminder_minutes)
      ORDER BY l.vence_at FOR UPDATE OF l SKIP LOCKED`, [now]);
    for (const loan of selected.rows) {
      const remaining = minutesUntil(loan.vence_at, now);
      try {
        await sendMail({
          to: loan.email,
          subject: 'Recordatorio de devolución',
          html: `<p>La notebook ${escapeEmailHtml(loan.notebook)} vence en ${remaining} min.</p>`
        });
      } catch (error) {
        console.error('No se pudo enviar un recordatorio de devolución.', error);
        continue;
      }
      const marked = await client.query(`UPDATE loans SET reminder_sent_at = now()
        WHERE id = $1 AND reminder_sent_at IS NULL`, [loan.id]);
      sent += marked.rowCount;
    }
  });
  return { sent };
}

function escapeEmailHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function requireAdmin(user, message) {
  if (user.rol !== 'admin') throw new AppError(message, 403);
}

async function queryCarros(client = db) {
  const [result, locations] = await Promise.all([
    client.query(`SELECT c.numero, c.ubicacion,
      COUNT(n.id)::integer AS total,
      COUNT(n.id) FILTER (WHERE n.estado = 'disponible'
        AND NOT EXISTS (SELECT 1 FROM reservation_notebooks rn
          WHERE rn.notebook_id = n.id AND rn.active))::integer AS disponibles
    FROM carros c LEFT JOIN notebooks n ON n.carro_id = c.numero
    GROUP BY c.numero, c.ubicacion ORDER BY c.numero`),
    client.query('SELECT slug, nombre FROM ubicaciones ORDER BY nombre')
  ]);
  return { carros: result.rows, ubicaciones: locations.rows };
}

function carroNumber(value, label = 'El número de carro') {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 999) {
    throw new AppError(`${label} debe contener de 1 a 3 dígitos, entre 1 y 999`, 400);
  }
  return Number(text);
}

function reservationCarroId(value) {
  const match = String(value ?? '').match(/^\s*(?:Carro\s*)?(\d{1,3})\s*$/i);
  return match && Number(match[1]) >= 1 ? String(Number(match[1])) : null;
}

async function assignReservationNotebooks(client, reservation) {
  const carroId = reservationCarroId(reservation.carro);
  await client.query(`UPDATE reservation_notebooks rn SET active = FALSE
    FROM notebooks n WHERE rn.reservation_id = $1 AND rn.active AND n.id = rn.notebook_id
      AND (n.estado <> 'disponible' OR ($2::text IS NOT NULL AND n.carro_id::text <> $2))`,
  [reservation.id, carroId]);
  const assigned = await client.query(`SELECT n.id, n.codigo FROM reservation_notebooks rn
    JOIN notebooks n ON n.id = rn.notebook_id
    WHERE rn.reservation_id = $1 AND rn.active
      AND ($2::text IS NULL OR n.carro_id::text = $2) FOR UPDATE OF rn`,
  [reservation.id, carroId]);
  if (assigned.rowCount >= reservation.cantidad) return assigned.rows;
  const missing = reservation.cantidad - assigned.rowCount;
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
    [reservation.id, notebook.id]);
  }
  return [...assigned.rows, ...available.rows];
}

async function completeReservationCheckout(client, id) {
  const reservationResult = await client.query(`SELECT id, owner_id, tipo, curso, cantidad,
    retiro_at, hora_devolucion, estado, carro
    FROM reservations WHERE id = $1 AND estado IN ('confirmada', 'aprobada', 'retirada') FOR UPDATE`, [id]);
  if (!reservationResult.rowCount) throw new AppError('Reserva no encontrada o no lista para retiro', 404);
  const reservation = reservationResult.rows[0];
  const existingLoans = await client.query('SELECT id FROM loans WHERE reservation_id = $1', [id]);
  if (existingLoans.rowCount) {
    return { message: 'El retiro ya estaba registrado', loansCreated: 0, deliveries: [] };
  }
  const notebooks = await assignReservationNotebooks(client, reservation);
  const retiradaAt = new Date();
  const horaDevolucion = reservation.hora_devolucion
    ? String(reservation.hora_devolucion).slice(0, 5)
    : null;
  const venceAt = loanDueAt(retiradaAt, horaDevolucion);
  for (const notebook of notebooks) {
    await client.query(`INSERT INTO loans (notebook_id, user_id, reservation_id, curso, retirada_at, vence_at, estado)
      VALUES ($1, $2, $3, $4, $5, $6, 'activo')`,
    [notebook.id, reservation.owner_id, id, reservation.curso, retiradaAt, venceAt]);
    await client.query("UPDATE notebooks SET estado = 'prestada', ubicacion = '—', prestado_a = $1, updated_at = now() WHERE id = $2",
    [reservation.owner_id, notebook.id]);
  }
  await client.query('UPDATE reservation_notebooks SET active = FALSE WHERE reservation_id = $1', [id]);
  await client.query("UPDATE reservations SET estado = 'retirada' WHERE id = $1", [id]);
  return {
    message: 'Retiro registrado',
    loansCreated: notebooks.length,
    deliveries: notebooks.map((notebook) => ({ notebook: notebook.codigo, dueAt: venceAt })),
    ownerId: reservation.owner_id
  };
}

async function completeLoanReturn(client, loanId, adminId) {
  const loanResult = await client.query(`SELECT id, user_id, notebook_id, estado, vence_at
    FROM loans WHERE id = $1 FOR UPDATE`, [loanId]);
  if (!loanResult.rowCount) throw new AppError('Préstamo no encontrado', 404);
  const loan = loanResult.rows[0];
  if (loan.estado === 'devuelto') throw new AppError('El préstamo ya fue devuelto', 409);
  if (!['activo', 'devolucion_pendiente'].includes(loan.estado)) {
    throw new AppError('El préstamo no se puede devolver en su estado actual', 409);
  }
  const updated = await client.query(`UPDATE loans SET estado = 'devuelto',
    devuelta_at = now() WHERE id = $1 AND estado IN ('activo', 'devolucion_pendiente')
    RETURNING devuelta_at`, [loanId]);
  if (!updated.rowCount) throw new AppError('El préstamo ya fue devuelto', 409);
  await client.query(`INSERT INTO returns
    (loan_id, hora_prevista, confirmado_at, confirmado_por, estado)
    VALUES ($1, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::time, now(), $2, 'confirmada')
    ON CONFLICT (loan_id) DO UPDATE SET estado = 'confirmada',
      confirmado_at = EXCLUDED.confirmado_at, confirmado_por = EXCLUDED.confirmado_por`,
  [loanId, adminId]);
  await client.query(`UPDATE notebooks SET
    estado = CASE WHEN EXISTS (SELECT 1 FROM tickets
      WHERE notebook_id = $1::bigint AND estado IN ('abierto', 'progreso'))
      THEN 'mantenimiento'::notebook_status ELSE 'disponible'::notebook_status END,
    ubicacion = CASE WHEN EXISTS (SELECT 1 FROM tickets
      WHERE notebook_id = $1::bigint AND estado IN ('abierto', 'progreso'))
      THEN 'Taller' ELSE COALESCE('Carro ' || carro_id::text, ubicacion) END,
    prestado_a = NULL, updated_at = now()
    WHERE id = $1::bigint`, [loan.notebook_id]);
  return { message: 'Devolución registrada', loanId, userId: loan.user_id, notebookId: loan.notebook_id };
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
  const ubicacion = body.ubicacion === undefined
    ? 'todas'
    : typeof body.ubicacion === 'string' ? body.ubicacion.trim() : '';
  if (!ubicacion || ubicacion.length > 20) {
    throw new AppError('Seleccioná una ubicación válida', 400);
  }
  return {
    code: `RES-${Date.now()}`,
    ownerId: user.id,
    type,
    carro: String(Number(carro)),
    ubicacion,
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
    const result = await db.query("SELECT dni, nombre, email FROM users WHERE rol = 'profesor' ORDER BY nombre");
    return { professors: result.rows };
  },
  async users(_body, user, _params, query) {
    requireAdmin(user, 'Solo admin puede consultar usuarios');
    const role = query?.get('rol');
    if (role && !['alumno', 'profesor', 'admin'].includes(role)) throw new AppError('Rol de usuario inválido', 400);
    const result = await db.query(`SELECT dni, nombre, email, rol,
      (baneado AND (baneado_hasta IS NULL OR baneado_hasta > now())) AS baneado,
      baneado_hasta
      FROM users WHERE ($1::user_role IS NULL OR rol = $1::user_role)
      ORDER BY nombre`, [role || null]);
    return { users: result.rows };
  },
  async createUser(body, user) {
    requireAdmin(user, 'Solo admin puede crear usuarios');
    const nombre = personName(body.nombre, 'El nombre');
    const apellido = personName(body.apellido, 'El apellido');
    const nombreCompleto = `${nombre} ${apellido}`;
    const email = accountEmail(body.email);
    const dni = dniIdentifier(body.dni);
    const password = accountPassword(body.password);
    if (!['alumno', 'profesor'].includes(body.rol)) throw new AppError('Rol inválido', 400);
    try {
      return await db.transaction(async (client) => {
        const inserted = await client.query(`INSERT INTO users (dni, nombre, email, rol, password_hash, baneado)
          VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')), FALSE)
          RETURNING id, dni, nombre, email, rol, baneado`, [dni, nombreCompleto, email, body.rol, password]);
        await client.query(`INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes)
          VALUES ($1, TRUE, 30)`, [inserted.rows[0].id]);
        return { user: inserted.rows[0] };
      });
    } catch (error) {
      if (error.code === '23505') throw new AppError('El email o el DNI ya están registrados', 409);
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
    return queryCarros();
  },
  async availableCarros(_body, _user) {
    return queryCarros();
  },
  async ubicaciones(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar ubicaciones');
    const result = await db.query('SELECT slug, nombre FROM ubicaciones ORDER BY nombre');
    return { ubicaciones: result.rows };
  },
  async createUbicacion(body, user) {
    requireAdmin(user, 'Solo admin puede crear ubicaciones');
    const nombre = requiredText(body.nombre, 'El nombre de la ubicación', 50, { minimum: 2 });
    const base = nombre.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20).replace(/-$/g, '') || 'ubicacion';
    for (let suffix = 1; suffix <= 999; suffix += 1) {
      const ending = suffix === 1 ? '' : `-${suffix}`;
      const slug = `${base.slice(0, 20 - ending.length).replace(/-$/g, '')}${ending}`;
      const exists = await db.query('SELECT 1 FROM ubicaciones WHERE slug = $1', [slug]);
      if (exists.rowCount) continue;
      try {
        const result = await db.query('INSERT INTO ubicaciones (slug, nombre) VALUES ($1, $2) RETURNING slug, nombre', [slug, nombre]);
        return { ubicacion: result.rows[0] };
      } catch (error) {
        if (error.code !== '23505') throw error;
      }
    }
    throw new AppError('No se pudo generar un identificador único para la ubicación', 409);
  },
  async updateUbicacion(body, user, { slug }) {
    requireAdmin(user, 'Solo admin puede modificar ubicaciones');
    const nombre = requiredText(body.nombre, 'El nombre de la ubicación', 50, { minimum: 2 });
    const result = await db.query('UPDATE ubicaciones SET nombre = $1 WHERE slug = $2 RETURNING slug, nombre', [nombre, slug]);
    if (!result.rowCount) throw new AppError('Ubicación no encontrada', 404);
    return { ubicacion: result.rows[0] };
  },
  async deleteUbicacion(_body, user, { slug }) {
    requireAdmin(user, 'Solo admin puede eliminar ubicaciones');
    try {
      return await db.transaction(async (client) => {
        const location = await client.query('SELECT slug FROM ubicaciones WHERE slug = $1 FOR UPDATE', [slug]);
        if (!location.rowCount) throw new AppError('Ubicación no encontrada', 404);
        const used = await client.query('SELECT COUNT(*)::integer AS cantidad FROM carros WHERE ubicacion = $1', [slug]);
        if (used.rows[0].cantidad) {
          throw new AppError(`No se puede eliminar: ${used.rows[0].cantidad} carro(s) usan esta ubicación`, 409, {
            carros: used.rows[0].cantidad
          });
        }
        await client.query('DELETE FROM ubicaciones WHERE slug = $1', [slug]);
        return { message: 'Ubicación eliminada' };
      });
    } catch (error) {
      if (error.code === '23503') throw new AppError('No se puede eliminar una ubicación que usan carros', 409);
      throw error;
    }
  },
  async createCarro(body, user) {
    requireAdmin(user, 'Solo admin puede crear carros');
    const numero = carroNumber(body.numero);
    try {
      const result = await db.query('INSERT INTO carros (numero) VALUES ($1) RETURNING numero', [numero]);
      return { carro: result.rows[0] };
    } catch (error) {
      if (error.code === '23505') throw new AppError('Ya existe un carro con ese número', 409);
      throw error;
    }
  },
  async updateCarro(body, user, { numero: currentNumber }) {
    requireAdmin(user, 'Solo admin puede modificar carros');
    const current = carroNumber(currentNumber);
    const changes = [];
    const params = [current];
    if (Object.hasOwn(body, 'numero')) {
      params.push(carroNumber(body.numero));
      changes.push(`numero = $${params.length}`);
    }
    if (Object.hasOwn(body, 'ubicacion')) {
      if (body.ubicacion !== null) {
        const location = await db.query('SELECT 1 FROM ubicaciones WHERE slug = $1', [body.ubicacion]);
        if (!location.rowCount) throw new AppError('La ubicación del carro no es válida', 400);
      }
      params.push(body.ubicacion);
      changes.push(`ubicacion = $${params.length}`);
    }
    if (!changes.length) throw new AppError('Indicá el nuevo número o la ubicación del carro', 400);
    try {
      const result = await db.query(
        `UPDATE carros SET ${changes.join(', ')} WHERE numero = $1 RETURNING numero, ubicacion`,
        params
      );
      if (!result.rowCount) throw new AppError('Carro no encontrado', 404);
      return { carro: result.rows[0] };
    } catch (error) {
      if (error.code === '23505') throw new AppError('Ya existe un carro con ese número', 409);
      throw error;
    }
  },
  async deleteCarro(body, user, { numero }) {
    requireAdmin(user, 'Solo admin puede eliminar carros');
    const carro = carroNumber(numero);
    try {
      return await db.transaction(async (client) => {
        const source = await client.query('SELECT numero FROM carros WHERE numero = $1 FOR UPDATE', [carro]);
        if (!source.rowCount) throw new AppError('Carro no encontrado', 404);
        const count = await client.query('SELECT COUNT(*)::integer AS cantidad FROM notebooks WHERE carro_id = $1', [carro]);
        const notebookCount = count.rows[0].cantidad;
        if (notebookCount && body.destino === undefined) {
          throw new AppError(`El carro tiene ${notebookCount} notebooks`, 409, { notebookCount });
        }
        if (notebookCount) {
          const destino = carroNumber(body.destino, 'El carro de destino');
          if (destino === carro) throw new AppError('Elegí otro carro de destino', 400);
          const target = await client.query('SELECT numero FROM carros WHERE numero = $1 FOR UPDATE', [destino]);
          if (!target.rowCount) throw new AppError('El carro de destino no existe', 400);
          await client.query('UPDATE notebooks SET carro_id = $1 WHERE carro_id = $2', [destino, carro]);
        }
        await client.query('DELETE FROM carros WHERE numero = $1', [carro]);
        return { message: 'Carro eliminado', moved: notebookCount };
      });
    } catch (error) {
      if (error.code !== '23503') throw error;
      const current = await db.query('SELECT COUNT(*)::integer AS cantidad FROM notebooks WHERE carro_id = $1', [carro]);
      const notebookCount = current.rows[0]?.cantidad || 0;
      throw new AppError(`El carro tiene ${notebookCount} notebooks y no se puede eliminar`, 409, { notebookCount });
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
    const hasState = Object.hasOwn(body, 'estado');
    const hasCarro = Object.hasOwn(body, 'carro');
    if (!hasState && !hasCarro) throw new AppError('Indicá el estado o el carro de destino', 400);
    if (hasState && !['disponible', 'mantenimiento'].includes(body.estado)) {
      throw new AppError('Estado de notebook inválido', 400);
    }
    const carro = hasCarro ? carroNumber(body.carro, 'El carro de destino') : null;
    return db.transaction(async (client) => {
      const current = await client.query('SELECT id, estado, carro_id FROM notebooks WHERE codigo = $1 FOR UPDATE', [code]);
      if (!current.rowCount) throw new AppError('Notebook no encontrada', 404);
      if (hasState && !['disponible', 'mantenimiento'].includes(current.rows[0].estado)) {
        throw new AppError('No se puede cambiar manualmente el estado de una notebook prestada', 409);
      }
      if (hasCarro) {
        const target = await client.query('SELECT numero FROM carros WHERE numero = $1 FOR SHARE', [carro]);
        if (!target.rowCount) throw new AppError('El carro de destino no existe', 400);
      }
      const result = await client.query(`UPDATE notebooks SET
        estado = CASE WHEN $1::text IS NULL THEN estado ELSE $1::notebook_status END,
        carro_id = CASE WHEN $2::integer IS NULL THEN carro_id ELSE $2::integer END,
        ubicacion = CASE
          WHEN $1::text = 'mantenimiento' THEN 'Taller'
          WHEN $1::text = 'disponible' THEN COALESCE('Carro ' || COALESCE($2::integer, carro_id)::text, ubicacion)
          WHEN $2::integer IS NOT NULL AND estado = 'disponible' THEN 'Carro ' || $2::integer::text
          ELSE ubicacion END,
        prestado_a = CASE WHEN $1::text IS NULL THEN prestado_a ELSE NULL END,
        updated_at = now()
        WHERE id = $3 RETURNING codigo AS id, estado, ubicacion, carro_id`,
      [hasState ? body.estado : null, carro, current.rows[0].id]);
      if (hasState && ['disponible', 'mantenimiento'].includes(body.estado)) {
        await client.query('UPDATE reservation_notebooks SET active = FALSE WHERE notebook_id = $1 AND active', [current.rows[0].id]);
      }
      if (hasState && body.estado === 'disponible') {
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
      const selectedCarro = await client.query('SELECT numero, ubicacion FROM carros WHERE numero = $1 FOR SHARE', [
        Number(reservation.carro)
      ]);
      if (!selectedCarro.rowCount) throw new AppError('El carro seleccionado no existe', 400);
      if (reservation.ubicacion !== 'todas' && selectedCarro.rows[0].ubicacion !== reservation.ubicacion) {
        throw new AppError('El carro no pertenece a la ubicación seleccionada', 400);
      }
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
  async adminReservations(_body, user, _params, query) {
    requireAdmin(user, 'Solo admin puede consultar reservas');
    const q = searchText(query?.get('q'));
    const values = q ? [searchPattern(q)] : [];
    const where = q
      ? `WHERE r.estado IN ('pendiente_aprobacion', 'aprobada', 'confirmada')
          AND ${matchesSearchSql()}`
      : '';
    const limit = q ? 'LIMIT 50' : '';
    const result = await db.query(`SELECT r.id, r.codigo, r.tipo, r.carro, r.curso, r.cantidad,
      r.retiro_at, r.hora_devolucion, r.motivo, r.estado,
      u.dni, u.nombre, u.email, COUNT(DISTINCT rn.notebook_id)::integer AS equipos_asignados
      FROM reservations r JOIN users u ON u.id = r.owner_id
      LEFT JOIN reservation_notebooks rn ON rn.reservation_id = r.id AND rn.active
      LEFT JOIN notebooks n ON n.id = rn.notebook_id
      ${where}
      GROUP BY r.id, u.id ORDER BY r.retiro_at ${limit}`, values);
    return { reservations: result.rows };
  },
  async approveReservation(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede aprobar reservas');
    const result = await db.transaction(async (client) => {
      const reservation = await client.query(`SELECT id, owner_id, cantidad, carro FROM reservations
        WHERE id = $1 AND estado = 'pendiente_aprobacion' FOR UPDATE`, [id]);
      if (!reservation.rowCount) throw new AppError('Solicitud no encontrada o no pendiente de aprobación', 404);
      await assignReservationNotebooks(client, reservation.rows[0]);
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
    const result = await db.transaction((client) => completeReservationCheckout(client, id));
    for (const delivery of result.deliveries || []) {
      await notifyLoanCheckoutByEmail(result.ownerId, delivery.notebook, delivery.dueAt);
    }
    return { message: result.message, loansCreated: result.loansCreated };
  },
  async approveAndCheckoutReservation(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede aprobar y registrar retiros');
    const result = await db.transaction(async (client) => {
      const reservation = await client.query(`SELECT id, owner_id, tipo, cantidad, carro
        FROM reservations WHERE id = $1 AND estado = 'pendiente_aprobacion' FOR UPDATE`, [id]);
      if (!reservation.rowCount) throw new AppError('Solicitud no encontrada o no pendiente de aprobación', 404);
      if (reservation.rows[0].tipo !== 'lote') {
        throw new AppError('La aprobación y entrega simultánea solo aplica a lotes', 400);
      }
      await assignReservationNotebooks(client, reservation.rows[0]);
      await client.query("UPDATE reservations SET estado = 'aprobada' WHERE id = $1", [id]);
      return completeReservationCheckout(client, id);
    });
    for (const delivery of result.deliveries || []) {
      await notifyLoanCheckoutByEmail(result.ownerId, delivery.notebook, delivery.dueAt);
    }
    return { message: result.message, loansCreated: result.loansCreated };
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
  async adminLoans(_body, user, _params, query) {
    requireAdmin(user, 'Solo admin puede consultar préstamos');
    const q = searchText(query?.get('q'));
    const state = query?.get('estado') || 'activo';
    if (!['activo', 'devolucion_pendiente', 'devuelto'].includes(state)) {
      throw new AppError('Estado de préstamo inválido', 400);
    }
    const values = [state];
    let where = 'l.estado = $1::loan_status';
    if (q) {
      values.push(searchPattern(q));
      where += ` AND ${matchesSearchSql(`$${values.length}`)}`;
    }
    const result = await db.query(`SELECT l.id, u.id AS user_id, u.dni, u.nombre AS usuario,
      u.email, n.codigo AS notebook, l.curso, l.retirada_at, l.vence_at, l.devuelta_at,
      l.estado, (l.estado = 'activo' AND l.vence_at <= now()) AS vencido
      FROM loans l JOIN users u ON u.id = l.user_id JOIN notebooks n ON n.id = l.notebook_id
      WHERE ${where} ORDER BY l.vence_at, u.nombre LIMIT 50`, values);
    return { loans: result.rows };
  },
  async adminReturnLoan(_body, user, { id }) {
    requireAdmin(user, 'Solo admin puede registrar devoluciones');
    const result = await db.transaction((client) => completeLoanReturn(client, id, user.id));
    await notifyLoanReturnByEmail(result.loanId);
    return { message: result.message };
  },
  async adminReturnLoans(body, user) {
    requireAdmin(user, 'Solo admin puede registrar devoluciones');
    const loanIds = body.loanIds;
    if (!Array.isArray(loanIds) || loanIds.length < 2 || loanIds.length > 50
      || loanIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1)
      || new Set(loanIds.map(Number)).size !== loanIds.length) {
      throw new AppError('Seleccioná entre 2 y 50 préstamos válidos', 400);
    }
    const result = await db.transaction(async (client) => {
      const returns = [];
      for (const id of loanIds) {
        returns.push(await completeLoanReturn(client, Number(id), user.id));
      }
      if (new Set(returns.map((item) => String(item.userId))).size !== 1) {
        throw new AppError('Los préstamos deben pertenecer a la misma persona', 400);
      }
      return returns;
    });
    for (const item of result) await notifyLoanReturnByEmail(item.loanId);
    return { message: `Se registraron ${result.length} devoluciones` };
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
    const result = await db.query(`SELECT r.id, n.codigo AS notebook, u.dni, u.nombre, l.curso,
      r.solicitado_at, r.hora_prevista, res.hora_devolucion, l.vence_at
      FROM returns r JOIN loans l ON l.id = r.loan_id JOIN notebooks n ON n.id = l.notebook_id
      JOIN users u ON u.id = l.user_id LEFT JOIN reservations res ON res.id = l.reservation_id
      WHERE r.estado = 'pendiente' ORDER BY r.solicitado_at`);
    return { returns: result.rows };
  },
  async adminOpenLoans(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar préstamos no devueltos');
    const result = await db.query(`SELECT l.id, n.codigo AS notebook, u.dni, u.nombre, u.rol,
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
      const pending = await client.query(
        'SELECT loan_id FROM returns WHERE id = $1 AND estado = $2 FOR UPDATE',
        [id, 'pendiente']
      );
      if (!pending.rowCount) throw new AppError('Devolución pendiente no encontrada', 404);
      return completeLoanReturn(client, pending.rows[0].loan_id, user.id);
    });
    await notifyLoanReturnByEmail(result.loanId);
    return { message: 'Devolución confirmada' };
  },
  async ticketNotebooks(_body, user) {
    const result = await db.query(`SELECT n.codigo, MAX(l.retirada_at) AS ultimo_uso
      FROM loans l JOIN notebooks n ON n.id = l.notebook_id
      WHERE l.user_id = $1 GROUP BY n.id, n.codigo
      ORDER BY MAX(l.retirada_at) DESC, n.codigo`, [user.id]);
    return { notebooks: result.rows };
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
    if (body.notebook !== undefined && body.notebook !== null && body.notebook !== '' && body.notebook !== 'otro') {
      notebook = requiredText(body.notebook, 'La notebook');
    }
    return db.transaction(async (client) => {
      let notebookId = null;
      if (notebook) {
        const existing = await client.query(`SELECT n.id,
          EXISTS (SELECT 1 FROM loans l WHERE l.notebook_id = n.id AND l.user_id = $2) AS in_history
          FROM notebooks n WHERE n.codigo = $1 FOR UPDATE OF n`, [notebook, user.id]);
        if (!existing.rowCount) throw new AppError('La notebook seleccionada no existe', 400);
        if (user.rol !== 'admin' && !existing.rows[0].in_history) {
          throw new AppError('Solo podés asociar notebooks de tu historial de préstamos', 400);
        }
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
  async ticketReplies(_body, user, { code }) {
    const ticket = await db.query('SELECT id, owner_id FROM tickets WHERE codigo = $1', [code]);
    if (!ticket.rowCount) throw new AppError('Ticket no encontrado', 404);
    if (user.rol !== 'admin' && String(ticket.rows[0].owner_id) !== String(user.id)) {
      throw new AppError('No podés consultar las respuestas de este ticket', 403);
    }
    const result = await db.query(`SELECT r.id, r.mensaje, r.created_at,
      u.id AS author_id, u.nombre AS autor, u.rol AS author_role
      FROM ticket_replies r JOIN users u ON u.id = r.author_id
      WHERE r.ticket_id = $1 ORDER BY r.created_at, r.id`, [ticket.rows[0].id]);
    return { replies: result.rows };
  },
  async createTicketReply(body, user, { code }) {
    const message = requiredText(body.mensaje, 'El mensaje', 500);
    const result = await db.transaction(async (client) => {
      const ticket = await client.query('SELECT id, owner_id, estado, notebook_id FROM tickets WHERE codigo = $1 FOR UPDATE', [code]);
      if (!ticket.rowCount) throw new AppError('Ticket no encontrado', 404);
      const record = ticket.rows[0];
      if (user.rol !== 'admin' && String(record.owner_id) !== String(user.id)) {
        throw new AppError('No podés responder este ticket', 403);
      }
      const inserted = await client.query(`INSERT INTO ticket_replies (ticket_id, author_id, mensaje)
        VALUES ($1, $2, $3) RETURNING id, mensaje, created_at`,
      [record.id, user.id, message]);
      if (user.rol !== 'admin' && record.estado === 'resuelto') {
        await client.query(`UPDATE tickets SET estado = 'abierto', resolved_at = NULL, resolved_by = NULL
          WHERE id = $1`, [record.id]);
        if (record.notebook_id) {
          await client.query(`UPDATE notebooks SET estado = 'mantenimiento',
            ubicacion = 'Taller', updated_at = now()
            WHERE id = $1::bigint AND estado = 'disponible'`, [record.notebook_id]);
        }
      }
      return { reply: inserted.rows[0], ownerId: record.owner_id };
    });
    if (user.rol === 'admin') {
      await notifyByEmail(result.ownerId, 'Nueva respuesta en tu ticket', '<p>Administración respondió a tu ticket en NetMO.</p>');
    }
    return { reply: result.reply };
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
  async sendReturnReminders(request, now = new Date()) {
    const expected = process.env.CRON_SECRET || config.cronSecret;
    if (!expected) throw new AppError('CRON_SECRET no está configurado', 503);
    const provided = request.headers['x-cron-secret'];
    const expectedDigest = crypto.createHash('sha256').update(expected).digest();
    const providedDigest = crypto.createHash('sha256')
      .update(typeof provided === 'string' ? provided : '')
      .digest();
    if (typeof provided !== 'string'
      || !crypto.timingSafeEqual(expectedDigest, providedDigest)
      || provided.length !== expected.length) {
      throw new AppError('No autorizado', 401);
    }
    return runReturnReminders(now);
  },
  async runAdminReminders(_body, user) {
    requireAdmin(user, 'Solo admin puede enviar recordatorios');
    return runReturnReminders(new Date());
  },
  async lateReturns(_body, user) {
    requireAdmin(user, 'Solo admin puede consultar demoras');
    const users = await db.query(`SELECT summary.*, (u.baneado AND (u.baneado_hasta IS NULL OR u.baneado_hasta > now())) AS baneado,
      u.baneado_hasta
      FROM user_late_return_summary summary JOIN users u ON u.id = summary.id
      ORDER BY summary.tardanzas DESC, summary.nombre`);
    const history = await db.query(`SELECT u.nombre, u.rol, u.dni, n.codigo AS notebook_id,
      lr.returned_at AS fecha FROM late_returns lr JOIN users u ON u.id = lr.user_id
      JOIN notebooks n ON n.id = lr.notebook_id ORDER BY lr.returned_at DESC`);
    return { users: users.rows, history: history.rows };
  },
  async updateUser(body, user, { dni }) {
    requireAdmin(user, 'Solo admin puede suspender usuarios');
    if (typeof body.baneado !== 'boolean') throw new AppError('El estado de baneo es inválido', 400);
    let duration = null;
    if (body.baneado && body.duracionDias !== undefined && body.duracionDias !== null) {
      duration = Number(body.duracionDias);
      if (![1, 3, 7, 15, 30].includes(duration)) throw new AppError('La duración debe ser 1, 3, 7, 15 o 30 días, o indefinida', 400);
    }
    const result = await db.query(`UPDATE users SET baneado = $1,
      baneado_hasta = CASE WHEN NOT $1 OR $3::integer IS NULL THEN NULL ELSE now() + ($3::text || ' days')::interval END
      WHERE dni = $2 AND rol <> 'admin'
      RETURNING dni, nombre, baneado, baneado_hasta`, [body.baneado, dni, duration]);
    if (!result.rowCount) throw new AppError('Usuario no encontrado o no modificable', 404);
    return { user: result.rows[0] };
  },
  async updateUserRole(body, user, { dni }) {
    requireAdmin(user, 'Solo admin puede cambiar roles');
    if (!['alumno', 'profesor', 'admin'].includes(body.rol)) {
      throw new AppError('Rol inválido', 400);
    }
    return db.transaction(async (client) => {
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const current = await client.query('SELECT id, dni, nombre, email, rol FROM users WHERE dni = $1 FOR UPDATE', [dni]);
      if (!current.rowCount) throw new AppError('Usuario no encontrado', 404);
      const target = current.rows[0];
      if (String(target.id) === String(user.id)) throw new AppError('No podés cambiar tu propio rol', 403);
      if (target.rol === body.rol) return { user: target };
      if (body.rol === 'admin' && target.rol !== 'admin') {
        if (typeof body.password !== 'string' || !body.password) {
          throw new AppError('Confirmá tu contraseña para ascender a administrador', 400);
        }
        const confirmation = await client.query(`SELECT password_hash = crypt($1, password_hash) AS valid
          FROM users WHERE id = $2 AND rol = 'admin'`, [body.password, user.id]);
        if (!confirmation.rows[0]?.valid) throw new AppError('La contraseña del administrador no es correcta', 403);
      }
      if (target.rol === 'admin' && body.rol !== 'admin') {
        const admins = await client.query("SELECT COUNT(*)::integer AS total FROM users WHERE rol = 'admin'");
        if (Number(admins.rows[0]?.total) <= 1) {
          throw new AppError('No se puede dejar el sistema sin administradores', 409);
        }
      }
      const updated = await client.query('UPDATE users SET rol = $1 WHERE id = $2 RETURNING dni, nombre, email, rol', [
        body.rol, target.id
      ]);
      const auditTable = await client.query("SELECT to_regclass('public.audit_log') AS table_name");
      if (auditTable.rows[0]?.table_name) {
        await client.query(`INSERT INTO audit_log (user_id, accion, detalle) VALUES ($1, 'cambio_rol', $2)`, [
          user.id, JSON.stringify({ user_id: target.id, rol_anterior: target.rol, rol_nuevo: body.rol })
        ]);
      }
      return { user: updated.rows[0] };
    });
  }
};

module.exports = actions;
