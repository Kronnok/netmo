const db = require('../data/database');
const { AppError } = require('../errors');
const { createToken, verifyToken } = require('./session-token');
const loginRateLimiter = require('./login-rate-limiter');
const { loginEmail } = require('./validation');

async function authenticate(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const session = verifyToken(token);
  if (!session) throw new AppError('No autenticado', 401);
  await db.query(`UPDATE users SET baneado = FALSE, baneado_hasta = NULL,
    baneo_origen = NULL, tardanzas_reset_at = now()
    WHERE id = $1 AND baneado AND baneado_hasta IS NOT NULL AND baneado_hasta <= now()
    RETURNING id`, [session.userId]);
  const userResult = await db.query(`SELECT id, dni, nombre, email, rol, estado_registro,
    (baneado AND (baneado_hasta IS NULL OR baneado_hasta > now())) AS baneado
    FROM users WHERE id = $1 AND eliminado_at IS NULL`, [session.userId]);
  const user = userResult.rows[0];
  if (!user || user.estado_registro !== 'aprobado' || user.baneado) {
    throw new AppError('Cuenta no autorizada', 403);
  }
  return user;
}

function blockedMessage(user) {
  if (user.baneo_origen !== 'automatico') return 'Usuario bloqueado por administración';
  const until = user.baneado_hasta
    ? new Date(user.baneado_hasta).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      dateStyle: 'short',
      timeStyle: 'short'
    })
    : null;
  return `Cuenta bloqueada automáticamente por acumular 5 devoluciones tardías.${until ? ` Podés volver a ingresar a partir del ${until}.` : ''}`;
}

async function login(body, request) {
  const email = loginEmail(body.email);
  if (loginRateLimiter.isRateLimited(request, email)) {
    const minutes = loginRateLimiter.remainingMinutes(request, email);
    throw new AppError(`Demasiados intentos. Intentá nuevamente en ${minutes} minuto(s).`, 429);
  }
  if (typeof body.password !== 'string') throw new AppError('Correo o contraseña incorrectos', 401);
  const result = await db.query(
    `WITH cleared_expired_ban AS (
       UPDATE users SET baneado = FALSE, baneado_hasta = NULL,
         baneo_origen = NULL, tardanzas_reset_at = now()
       WHERE email = $1 AND baneado AND baneado_hasta IS NOT NULL AND baneado_hasta <= now()
       RETURNING id
     )
     SELECT id, dni, nombre, email, rol, estado_registro, baneo_origen, baneado_hasta,
      (baneado AND (baneado_hasta IS NULL OR baneado_hasta > now())) AS baneado
      FROM users WHERE email = $1 AND eliminado_at IS NULL
        AND password_hash = crypt($2, password_hash)`,
    [email, body.password]
  );
  const user = result.rows[0];
  if (!user) {
    loginRateLimiter.recordFailure(request, email);
    throw new AppError('Correo o contraseña incorrectos', 401);
  }
  if (user.estado_registro === 'pendiente') {
    throw new AppError('Tu cuenta está pendiente de aprobación', 403);
  }
  if (user.estado_registro === 'rechazado') {
    throw new AppError('Tu solicitud de registro fue rechazada', 403);
  }
  if (user.estado_registro !== 'aprobado') {
    throw new AppError('Cuenta no autorizada', 403);
  }
  if (user.baneado) throw new AppError(blockedMessage(user), 403);
  loginRateLimiter.clearFailures(request, email);
  return { token: createToken(user.id), user };
}

async function refresh(request) {
  const user = await authenticate(request);
  return { token: createToken(user.id) };
}

module.exports = { authenticate, login, refresh };
