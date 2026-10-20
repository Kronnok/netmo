const { Pool } = require('pg');
const config = require('../config');

if (!config.databaseUrl) throw new Error('DATABASE_URL es obligatorio');

const pool = new Pool({
  connectionString: config.databaseUrl,
  options: '-c timezone=America/Argentina/Buenos_Aires',
  ssl: /localhost|127\.0\.0\.1/.test(new URL(config.databaseUrl).hostname) ? false : { rejectUnauthorized: false }
});

pool.on('error', (error) => {
  console.error('Error inesperado en el pool PostgreSQL:', error);
});

async function query(text, values) {
  return pool.query(text, values);
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
