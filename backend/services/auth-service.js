const db = require('../data/database');
const { AppError } = require('../errors');
const { createToken, verifyToken } = require('./session-token');
const loginRateLimiter = require('./login-rate-limiter');
const { loginEmail } = require('./validation');

async function authenticate(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const session = verifyToken(token);
  if (!session) throw new AppError('No autenticado', 401);
  await db.query(`UPDATE users SET baneado = FALSE, baneado_hasta = NULL
    WHERE id = $1 AND baneado AND baneado_hasta IS NOT NULL AND baneado_hasta <= now()
    RETURNING id`, [session.userId]);
  const userResult = await db.query(`SELECT id, legajo, nombre, email, rol,
    (baneado AND (baneado_hasta IS NULL OR baneado_hasta > now())) AS baneado
    FROM users WHERE id = $1`, [session.userId]);
  const user = userResult.rows[0];
  if (!user || user.baneado) throw new AppError('Cuenta no autorizada', 403);
  return user;
}

async function login(body, request) {
  const email = loginEmail(body.email);
  if (loginRateLimiter.isRateLimited(request, email)) {
    throw new AppError('Demasiados intentos. Intentá nuevamente en 15 minutos.', 429);
  }
  if (typeof body.password !== 'string') throw new AppError('Correo o contraseña incorrectos', 401);
  await db.query(`UPDATE users SET baneado = FALSE, baneado_hasta = NULL
    WHERE email = $1 AND baneado AND baneado_hasta IS NOT NULL AND baneado_hasta <= now()`, [email]);
  const result = await db.query(
    `SELECT id, legajo, nombre, email, rol,
      (baneado AND (baneado_hasta IS NULL OR baneado_hasta > now())) AS baneado
      FROM users WHERE email = $1 AND password_hash = crypt($2, password_hash)`,
    [email, body.password]
  );
  const user = result.rows[0];
  if (!user) {
    loginRateLimiter.recordFailure(request, email);
    throw new AppError('Correo o contraseña incorrectos', 401);
  }
  if (user.baneado) throw new AppError('Usuario bloqueado por administración', 403);
  loginRateLimiter.clearFailures(request, email);
  return { token: createToken(user.id), user };
}

module.exports = { authenticate, login };
