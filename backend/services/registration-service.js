const db = require('../data/database');
const { AppError } = require('../errors');
const {
  personName,
  accountEmail,
  accountPassword,
  dniIdentifier,
  registrationRoleFromEmail
} = require('./validation');
const { sendMail } = require('./mail-service');
const rateLimiter = require('./login-rate-limiter');

const REGISTER_NAMESPACE = 'register';
const REGISTER_MESSAGE = 'Recibimos tu solicitud. Un administrador debe aprobar tu cuenta antes de que puedas iniciar sesión.';

function rateLimitMessage(request, email) {
  const minutes = rateLimiter.remainingMinutes(request, email, Date.now(), REGISTER_NAMESPACE);
  return `Demasiadas solicitudes de registro. Intentá nuevamente en ${minutes} minuto(s).`;
}

async function sendRegistrationReceived({ email, nombre }) {
  try {
    await sendMail({
      to: email,
      subject: 'Recibimos tu solicitud de cuenta en NetMO',
      html: `<p>Hola ${nombre},</p><p>Recibimos tu solicitud de cuenta en NetMO. Un administrador la va a revisar y, cuando la apruebe, vas a poder iniciar sesión con tu correo y contraseña.</p>`
    });
  } catch (error) {
    console.error('No se pudo enviar el correo de solicitud de registro.', error);
  }
}

async function register(body, request) {
  const email = accountEmail(body.email);
  if (rateLimiter.isRateLimited(request, email, Date.now(), REGISTER_NAMESPACE)) {
    throw new AppError(rateLimitMessage(request, email), 429);
  }
  rateLimiter.recordFailure(request, email, Date.now(), REGISTER_NAMESPACE);

  const nombre = personName(body.nombre, 'El nombre');
  const apellido = personName(body.apellido, 'El apellido');
  const dni = dniIdentifier(body.dni);
  const password = accountPassword(body.password);
  if (typeof body.passwordConfirmation !== 'string' || password !== body.passwordConfirmation) {
    throw new AppError('Las contraseñas no coinciden', 400);
  }
  const rol = registrationRoleFromEmail(email);

  let created;
  try {
    created = await db.transaction(async (client) => {
      const inserted = await client.query(`INSERT INTO users (dni, nombre, email, rol, password_hash, baneado, aprobado)
        VALUES ($1, $2, $3, $4, crypt($5, gen_salt('bf')), FALSE, FALSE)
        RETURNING id, dni, nombre, email, rol, aprobado`, [
        dni, `${nombre} ${apellido}`, email, rol, password
      ]);
      await client.query(`INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes)
        VALUES ($1, TRUE, 30)`, [inserted.rows[0].id]);
      return inserted.rows[0];
    });
  } catch (error) {
    if (error.code === '23505') throw new AppError('El email o el DNI ya están registrados', 409);
    throw error;
  }

  await sendRegistrationReceived({ email, nombre });
  return {
    message: REGISTER_MESSAGE,
    user: {
      dni: created.dni,
      nombre: created.nombre,
      email: created.email,
      rol: created.rol,
      aprobado: created.aprobado
    }
  };
}

module.exports = { register, REGISTER_MESSAGE };
