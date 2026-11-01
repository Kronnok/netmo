const crypto = require('node:crypto');
const db = require('../data/database');
const config = require('../config');
const { AppError } = require('../errors');
const { accountEmail, accountPassword } = require('./validation');
const { sendMail } = require('./mail-service');
const rateLimiter = require('./login-rate-limiter');

const GENERIC_FORGOT_RESPONSE = { message: 'Si el correo está registrado, recibirás instrucciones para continuar.' };

function digestCode(code, userId) {
  if (!config.jwtSecret) throw new Error('JWT_SECRET es obligatorio para proteger los códigos');
  return crypto.createHmac('sha256', config.jwtSecret).update(`${code}${userId}`).digest();
}

function codeMatches(code, expectedHash, userId) {
  const actualHash = digestCode(code, userId);
  return expectedHash.length === actualHash.length && crypto.timingSafeEqual(expectedHash, actualHash);
}

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function sendIssuedCode({ userId, email, purpose, codeHash, code }) {
  try {
    await sendMail({
      to: email,
      subject: purpose === 'reset' ? 'Recuperar contraseña de NetMO' : 'Cambiar contraseña de NetMO',
      html: `<p>Tu código de verificación es:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>Vence en 10 minutos. Si no solicitaste este cambio, ignorá este correo.</p>`
    });
  } catch (error) {
    await db.query(`UPDATE password_resets SET used_at = now()
      WHERE user_id = $1 AND purpose = $2 AND code_hash = $3 AND used_at IS NULL`, [userId, purpose, codeHash]);
    throw error;
  }
}

function recordRequest(request, email, namespace) {
  if (rateLimiter.isRateLimited(request, email, Date.now(), namespace)) return false;
  rateLimiter.recordFailure(request, email, Date.now(), namespace);
  return true;
}

async function requestForgot(body, request) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) throw new AppError('El email no puede estar vacío.', 400);
  if (email.length > 50) throw new AppError('El email no puede superar 50 caracteres.', 400);
  if (!recordRequest(request, email, 'password-forgot')) return GENERIC_FORGOT_RESPONSE;
  let normalizedEmail;
  try {
    normalizedEmail = accountEmail(email);
  } catch {
    return GENERIC_FORGOT_RESPONSE;
  }

  try {
    const issued = await db.transaction(async (client) => {
      const result = await client.query(`SELECT id, email FROM users
        WHERE email = $1 AND (NOT baneado OR (baneado_hasta IS NOT NULL AND baneado_hasta <= now()))
        FOR UPDATE`, [normalizedEmail]);
      if (!result.rowCount) return null;
      const cooldown = await client.query(`SELECT 1 FROM password_resets
        WHERE user_id = $1 AND purpose = 'reset' AND created_at > now() - interval '60 seconds'
        LIMIT 1`, [result.rows[0].id]);
      if (cooldown.rowCount) return null;
      const code = generateCode();
      const codeHash = digestCode(code, result.rows[0].id);
      await client.query(`UPDATE password_resets SET used_at = now()
        WHERE user_id = $1 AND purpose = 'reset' AND used_at IS NULL`, [result.rows[0].id]);
      await client.query(`INSERT INTO password_resets (user_id, code_hash, purpose, expires_at)
        VALUES ($1, $2, 'reset', now() + interval '10 minutes')`, [result.rows[0].id, codeHash]);
      return { ...result.rows[0], code, codeHash };
    });
    if (issued) await sendIssuedCode({ userId: issued.id, email: issued.email, purpose: 'reset', code: issued.code, codeHash: issued.codeHash });
  } catch (error) {
    console.error('No se pudo procesar una solicitud de recuperación de contraseña.');
  }
  return GENERIC_FORGOT_RESPONSE;
}

async function requestChange(body, user, request) {
  const email = user.email.toLowerCase();
  if (!recordRequest(request, email, 'password-change-request')) throw new AppError('Demasiadas solicitudes. Intentá nuevamente más tarde.', 429);
  try {
    const issued = await db.transaction(async (client) => {
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      const cooldown = await client.query(`SELECT 1 FROM password_resets
        WHERE user_id = $1 AND purpose = 'change' AND created_at > now() - interval '60 seconds'
        LIMIT 1`, [user.id]);
      if (cooldown.rowCount) throw new AppError('Esperá 60 segundos antes de solicitar otro código.', 429);
      const code = generateCode();
      const codeHash = digestCode(code, user.id);
      await client.query(`UPDATE password_resets SET used_at = now()
        WHERE user_id = $1 AND purpose = 'change' AND used_at IS NULL`, [user.id]);
      await client.query(`INSERT INTO password_resets (user_id, code_hash, purpose, expires_at)
        VALUES ($1, $2, 'change', now() + interval '10 minutes')`, [user.id, codeHash]);
      return { code, codeHash };
    });
    await sendIssuedCode({ userId: user.id, email: user.email, purpose: 'change', ...issued });
    return { message: 'Si el envío se completó, recibirás un código en tu correo.' };
  } catch (error) {
    if (error.status) throw error;
    console.error('No se pudo enviar un código para cambiar la contraseña.');
    throw new AppError('No se pudo enviar el código. Intentá nuevamente más tarde.', 503);
  }
}

async function applyPasswordChange({ email, userId, purpose, code, password, request }) {
  const genericError = purpose === 'reset'
    ? 'No se pudo restablecer la contraseña. Revisá el código e intentá nuevamente.'
    : 'No se pudo cambiar la contraseña. Revisá el código e intentá nuevamente.';
  const rateKey = email || String(userId);
  const rateNamespace = purpose === 'reset' ? 'password-reset' : 'password-change';
  if (!recordRequest(request, rateKey, rateNamespace)) throw new AppError(genericError, 429);
  accountPassword(password);
  try {
    const updated = await db.transaction(async (client) => {
      const userResult = email
        ? await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [email])
        : await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!userResult.rowCount) throw new Error('invalid request');
      const targetUserId = userResult.rows[0].id;
      const resetResult = await client.query(`SELECT id, code_hash, attempts, expires_at, used_at
        FROM password_resets WHERE user_id = $1 AND purpose = $2
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [targetUserId, purpose]);
      if (!resetResult.rowCount) throw new Error('invalid request');
      const reset = resetResult.rows[0];
      if (reset.used_at || new Date(reset.expires_at) <= new Date() || reset.attempts >= 5) {
        throw new Error('invalid request');
      }
      const validCodeFormat = typeof code === 'string' && /^\d{6}$/.test(code);
      const matches = codeMatches(validCodeFormat ? code : '', reset.code_hash, targetUserId) && validCodeFormat;
      if (!matches) {
        const attempts = reset.attempts + 1;
        await client.query(`UPDATE password_resets SET attempts = $1,
          used_at = CASE WHEN $1 >= 5 THEN now() ELSE used_at END WHERE id = $2`, [attempts, reset.id]);
        return false;
      }
      await client.query("UPDATE users SET password_hash = crypt($1, gen_salt('bf')) WHERE id = $2", [password, targetUserId]);
      await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);
      await client.query(`UPDATE password_resets SET used_at = now()
        WHERE user_id = $1 AND purpose = $2 AND id <> $3 AND used_at IS NULL`, [targetUserId, purpose, reset.id]);
      return true;
    });
    if (!updated) throw new Error('invalid request');
    rateLimiter.clearFailures(request, rateKey, rateNamespace);
    return { message: 'La contraseña se actualizó correctamente.' };
  } catch {
    throw new AppError(genericError, 400);
  }
}

async function resetPassword(body, request) {
  const email = accountEmail(body.email);
  return applyPasswordChange({ email, purpose: 'reset', code: body.code, password: body.password, request });
}

async function changePassword(body, user, request) {
  return applyPasswordChange({
    userId: user.id,
    email: user.email.toLowerCase(),
    purpose: 'change',
    code: body.code,
    password: body.password,
    request
  });
}

module.exports = { requestForgot, requestChange, resetPassword, changePassword };
