const db = require('../data/database');
const { AppError } = require('../errors');
const {
  personName,
  accountEmail,
  roleFromEmail,
  validateEmailRole,
  accountPassword,
  dniIdentifier
} = require('./validation');
const { sendMail } = require('./mail-service');
const rateLimiter = require('./login-rate-limiter');

const REGISTRATION_NAMESPACE = 'registration';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function notifyRegistrationReceived(user) {
  try {
    await sendMail({
      to: user.email,
      subject: 'Recibimos tu solicitud de registro en NetMO',
      html: `<p>Hola ${escapeHtml(user.nombre)},</p>
        <p>Recibimos tu solicitud para crear una cuenta en NetMO. Un administrador la va a revisar y te avisaremos por este medio cuando esté aprobada.</p>`
    });
  } catch {
    console.error('No se pudo enviar el aviso de solicitud de registro.');
  }
}

async function notifyRegistrationDecision(user, estado) {
  try {
    const approved = estado === 'aprobado';
    await sendMail({
      to: user.email,
      subject: approved ? 'Tu cuenta de NetMO fue aprobada' : 'Tu solicitud de registro en NetMO fue rechazada',
      html: approved
        ? `<p>Hola ${escapeHtml(user.nombre)},</p>
          <p>Tu cuenta fue aprobada como ${user.rol === 'profesor' ? 'profesor' : 'alumno'}. Ya podés iniciar sesión en NetMO con tu correo y la contraseña que registraste.</p>`
        : `<p>Hola ${escapeHtml(user.nombre)},</p>
          <p>Tu solicitud de registro fue rechazada. Si necesitás corregir tus datos, podés volver a registrarte desde la pantalla de inicio de sesión.</p>`
    });
  } catch {
    console.error('No se pudo enviar el aviso de revisión de registro.');
  }
}

async function register(body, request) {
  const nombre = personName(body.nombre, 'El nombre');
  const apellido = personName(body.apellido, 'El apellido');
  const nombreCompleto = `${nombre} ${apellido}`;
  const email = accountEmail(body.email);
  const dni = dniIdentifier(body.dni);
  const password = accountPassword(body.password);
  if (typeof body.passwordConfirmation !== 'string' || password !== body.passwordConfirmation) {
    throw new AppError('Las contraseñas no coinciden', 400);
  }
  const domainRole = roleFromEmail(email);
  if (domainRole) {
    validateEmailRole(email, body.rol);
  } else if (body.rol !== undefined && !['alumno', 'profesor'].includes(body.rol)) {
    throw new AppError('Rol inválido', 400);
  }
  // Las cuentas @gmail.com quedan con un rol provisional hasta que el administrador lo defina al aprobar.
  const role = domainRole || 'alumno';

  if (rateLimiter.isRateLimited(request, email, Date.now(), REGISTRATION_NAMESPACE)) {
    const minutes = rateLimiter.remainingMinutes(request, email, Date.now(), REGISTRATION_NAMESPACE);
    throw new AppError(`Demasiadas solicitudes. Intentá nuevamente en ${minutes} minuto(s).`, 429);
  }
  rateLimiter.recordFailure(request, email, Date.now(), REGISTRATION_NAMESPACE);

  try {
    const result = await db.transaction(async (client) => {
      const existing = await client.query(`SELECT id, estado_registro, eliminado_at
        FROM users WHERE email = $1 OR dni = $2 FOR UPDATE`, [email, dni]);
      if (existing.rowCount > 1) {
        throw new AppError('El email o el DNI ya están registrados', 409);
      }
      if (existing.rowCount) {
        const current = existing.rows[0];
        if (current.eliminado_at) {
          throw new AppError('El email o el DNI ya están registrados', 409);
        }
        if (current.estado_registro !== 'rechazado') {
          throw new AppError('Ya existe una cuenta o solicitud con esos datos', 409);
        }
        const updated = await client.query(`UPDATE users SET
          dni = $1, nombre = $2, email = $3, rol = $4,
          password_hash = crypt($5, gen_salt('bf')),
          estado_registro = 'pendiente', registro_revisado_at = NULL, registro_revisado_por = NULL,
          baneado = FALSE, baneado_hasta = NULL
          WHERE id = $6
          RETURNING id, dni, nombre, email, rol, estado_registro`,
        [dni, nombreCompleto, email, role, password, current.id]);
        return { user: updated.rows[0], reapplied: true };
      }

      const inserted = await client.query(`INSERT INTO users
        (dni, nombre, email, rol, password_hash, baneado, estado_registro)
        VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')), FALSE, 'pendiente')
        RETURNING id, dni, nombre, email, rol, estado_registro`,
      [dni, nombreCompleto, email, role, password]);
      await client.query(`INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes)
        VALUES ($1, TRUE, 30)`, [inserted.rows[0].id]);
      return { user: inserted.rows[0], reapplied: false };
    });

    rateLimiter.clearFailures(request, email, REGISTRATION_NAMESPACE);
    await notifyRegistrationReceived(result.user);
    return {
      message: 'Solicitud enviada. Un administrador debe aprobar tu cuenta antes de que puedas iniciar sesión.',
      user: result.user
    };
  } catch (error) {
    if (error.code === '23505') throw new AppError('El email o el DNI ya están registrados', 409);
    throw error;
  }
}

module.exports = { register, notifyRegistrationDecision };
