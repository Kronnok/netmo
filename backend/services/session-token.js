const crypto = require('node:crypto');
const config = require('../config');

const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const TOKEN_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function createToken(userId, secret = config.jwtSecret, now = Date.now()) {
  if (!secret) throw new Error('JWT_SECRET es obligatorio para firmar sesiones');
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS
  })).toString('base64url');
  const content = `${TOKEN_HEADER}.${payload}`;
  const signature = crypto.createHmac('sha256', secret).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function verifyToken(token, secret = config.jwtSecret, now = Date.now()) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const content = `${header}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(content).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') return null;
    if (typeof decodedPayload.sub !== 'string' || !/^\d+$/.test(decodedPayload.sub)) return null;
    if (!Number.isInteger(decodedPayload.exp) || decodedPayload.exp <= Math.floor(now / 1000)) return null;
    return { userId: decodedPayload.sub };
  } catch {
    return null;
  }
}

module.exports = { createToken, verifyToken, TOKEN_LIFETIME_SECONDS };
