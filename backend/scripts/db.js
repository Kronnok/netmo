const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('../data/database');

const databaseDir = path.resolve(__dirname, '..', '..', 'database');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const exists = await client.query("SELECT to_regclass('public.users') AS users_table");
    if (!exists.rows[0].users_table) {
      await client.query(await fs.readFile(path.join(databaseDir, 'schema.sql'), 'utf8'));
      await client.query("INSERT INTO schema_migrations (version) VALUES ('000-initial-schema')");
      console.log('Esquema inicial aplicado.');
    }
    const migrations = [
      '001-course-belongs-to-operations.sql',
      '002-business-timezone.sql',
      '003-admin-accounts-and-carros.sql',
      '004-reservation-schedule.sql',
      '005-password-resets.sql',
      '006-admin-backup-audit.sql',
      '007-ticket-resolution-metadata.sql',
      '008-return-scheduled-time.sql',
      '009-reservation-return-time.sql'
    ];
    for (const version of migrations) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
      if (applied.rowCount) continue;
      await client.query(await fs.readFile(path.join(databaseDir, 'migrations', version), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      console.log(`Migración aplicada: ${version}`);
    }
  } finally {
    client.release();
  }
}

async function seed() {
  const names = [
    'NETMO_SEED_STUDENT_PASSWORD',
    'NETMO_SEED_TEACHER_PASSWORD',
    'NETMO_SEED_NETWORK_TEACHER_PASSWORD',
    'NETMO_SEED_ADMIN_PASSWORD'
  ];
  const passwords = names.map((name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} es obligatorio para cargar los datos iniciales`);
    return value;
  });
  const client = await pool.connect();
  try {
    const hasMigrationTable = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
    if (!hasMigrationTable.rows[0].table_name) throw new Error('Ejecutá npm run db:migrate antes de npm run db:seed');
    const seeded = await client.query("SELECT 1 FROM schema_migrations WHERE version = '002-seed'");
    if (seeded.rowCount) {
      console.log('El seed ya fue aplicado; no se hicieron cambios.');
      return;
    }
    await client.query('BEGIN');
    const settingNames = [
      'netmo.seed.student_password',
      'netmo.seed.teacher_password',
      'netmo.seed.network_teacher_password',
      'netmo.seed.admin_password'
    ];
    for (let index = 0; index < settingNames.length; index += 1) {
      await client.query('SELECT set_config($1, $2, true)', [settingNames[index], passwords[index]]);
    }
    await client.query(await fs.readFile(path.join(databaseDir, 'seed.sql'), 'utf8'));
    await client.query("INSERT INTO schema_migrations (version) VALUES ('002-seed')");
    await client.query('COMMIT');
    console.log('Datos iniciales cargados.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const command = process.argv[2];
  try {
    if (command === 'migrate') await migrate();
    else if (command === 'seed') await seed();
    else throw new Error('Uso: node scripts/db.js migrate|seed');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
