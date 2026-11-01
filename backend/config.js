const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT debe ser un entero entre 1 y 65535');
}

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || (nodeEnv === 'production' ? null : crypto.randomBytes(32).toString('hex'));
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : nodeEnv === 'production' ? [] : ['*'];
if (nodeEnv === 'production' && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGIN es obligatorio en producción');
}
if (nodeEnv === 'production' && !jwtSecret) {
  throw new Error('JWT_SECRET es obligatorio en producción');
}
if (jwtSecret && Buffer.byteLength(jwtSecret, 'utf8') < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 bytes');
}

module.exports = Object.freeze({
  port,
  nodeEnv,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret,
  corsOrigins,
  serveFrontend: nodeEnv !== 'production'
});
