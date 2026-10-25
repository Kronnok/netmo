<<<<<<< HEAD
const crypto = require('node:crypto');
const db = require('../data/database');
const { AppError } = require('../errors');
const { createToken, verifyToken } = require('./session-token');
const loginRateLimiter = require('./login-rate-limiter');

async function authenticate(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const session = verifyToken(token);
  if (!session) throw new AppError('No autenticado', 401);
  const result = await db.query('SELECT id, legajo, nombre, email, rol, baneado FROM users WHERE id = $1', [session.userId]);
  const user = result.rows[0];
  if (!user || user.baneado) throw new AppError('Cuenta no autorizada', 403);
  return user;
}

async function login(body, request) {
  if (loginRateLimiter.isRateLimited(request, body.email)) {
    throw new AppError('Demasiados intentos. Intentá nuevamente en 15 minutos.', 429);
  }
  const result = await db.query(
    'SELECT id, legajo, nombre, email, rol, baneado FROM users WHERE email = $1 AND password_hash = crypt($2, password_hash)',
    [body.email, body.password]
  );
  const user = result.rows[0];
  if (!user) {
    loginRateLimiter.recordFailure(request, body.email);
    throw new AppError('Correo o contraseña incorrectos', 401);
  }
  if (user.baneado) throw new AppError('Usuario bloqueado por administración', 403);
  loginRateLimiter.clearFailures(request, body.email);
  return { token: createToken(user.id), user };
}

async function register(body) {
  const nombre = String(body.nombre || '').trim();
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!nombre || !email || !password) throw new AppError('Nombre, correo y contraseña son obligatorios', 400);
  if (nombre.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('Nombre o correo inválido', 400);
  }
  if (password.length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres', 400);
  const legajo = `U-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    return await db.transaction(async (client) => {
      const result = await client.query(`INSERT INTO users (legajo, nombre, email, rol, password_hash, baneado)
        VALUES ($1, $2, $3, 'alumno', crypt($4, gen_salt('bf')), FALSE)
        RETURNING id, legajo, nombre, email, rol, baneado`, [legajo, nombre, email, password]);
      await client.query('INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes) VALUES ($1, TRUE, 30)', [result.rows[0].id]);
      return { user: result.rows[0] };
    });
  } catch (error) {
    if (error.code === '23505') throw new AppError('Ya existe una cuenta registrada con ese correo', 409);
    throw error;
  }
}

module.exports = { authenticate, login, register };
=======
const crypto = require('node:crypto');
const db = require('../data/database');
const { AppError } = require('../errors');
const { createToken, verifyToken } = require('./session-token');
const loginRateLimiter = require('./login-rate-limiter');

async function authenticate(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const session = verifyToken(token);
  if (!session) throw new AppError('No autenticado', 401);
  const result = await db.query('SELECT id, legajo, nombre, email, rol, baneado FROM users WHERE id = $1', [session.userId]);
  const user = result.rows[0];
  if (!user || user.baneado) throw new AppError('Cuenta no autorizada', 403);
  return user;
}

async function login(body, request) {
  if (loginRateLimiter.isRateLimited(request, body.email)) {
    throw new AppError('Demasiados intentos. Intentá nuevamente en 15 minutos.', 429);
  }
  const result = await db.query(
    'SELECT id, legajo, nombre, email, rol, baneado FROM users WHERE email = $1 AND password_hash = crypt($2, password_hash)',
    [body.email, body.password]
  );
  const user = result.rows[0];
  if (!user) {
    loginRateLimiter.recordFailure(request, body.email);
    throw new AppError('Correo o contraseña incorrectos', 401);
  }
  if (user.baneado) throw new AppError('Usuario bloqueado por administración', 403);
  loginRateLimiter.clearFailures(request, body.email);
  return { token: createToken(user.id), user };
}

async function register(body) {
  const nombre = String(body.nombre || '').trim();
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!nombre || !email || !password) throw new AppError('Nombre, correo y contraseña son obligatorios', 400);
  if (nombre.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('Nombre o correo inválido', 400);
  }
  if (password.length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres', 400);
  const legajo = `U-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    return await db.transaction(async (client) => {
      const result = await client.query(`INSERT INTO users (legajo, nombre, email, rol, password_hash, baneado)
        VALUES ($1, $2, $3, 'alumno', crypt($4, gen_salt('bf')), FALSE)
        RETURNING id, legajo, nombre, email, rol, baneado`, [legajo, nombre, email, password]);
      await client.query('INSERT INTO user_preferences (user_id, email_notifications, return_reminder_minutes) VALUES ($1, TRUE, 30)', [result.rows[0].id]);
      return { user: result.rows[0] };
    });
  } catch (error) {
    if (error.code === '23505') throw new AppError('Ya existe una cuenta registrada con ese correo', 409);
    throw error;
  }
}

module.exports = { authenticate, login, register };
>>>>>>> e4eeee9 (Harden auth, admin workflows, and business time rules)
