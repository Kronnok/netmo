const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../data/database');

process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/netmo_backup_unit_test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-hmac';

const backupService = require('../services/backup-service');

const tableNames = [
  'users', 'user_preferences', 'carros', 'notebooks', 'reservations',
  'reservation_notebooks', 'loans', 'returns', 'tickets', 'late_returns'
];

function createValidBackup() {
  const data = Object.fromEntries(tableNames.map((name) => [name, []]));
  data.users = [{
    id: '1',
    legajo: '100',
    nombre: 'Admin Test',
    email: 'admin@example.test',
    rol: 'admin',
    password_hash: 'hash',
    baneado: false,
    baneado_hasta: null,
    created_at: '2026-10-25T10:00:00.000Z'
  }];
  const columns = Object.fromEntries(tableNames.map((table) => [table, new Set([
    'id', 'legajo', 'nombre', 'email', 'rol', 'password_hash', 'baneado', 'baneado_hasta',
    'created_at', 'user_id', 'email_notifications', 'return_reminder_minutes', 'updated_at',
    'numero', 'codigo', 'estado', 'ubicacion', 'carro_id', 'prestado_a', 'owner_id', 'tipo',
    'carro', 'curso', 'cantidad', 'retiro_at', 'motivo', 'reservation_id', 'notebook_id',
    'active', 'vence_at', 'retirada_at', 'devuelta_at', 'loan_id', 'solicitado_at', 'hora_devolucion',
    'hora_prevista', 'confirmado_at', 'confirmado_por', 'descripcion', 'resolved_at', 'resolved_by',
    'returned_at', 'due_at'
  ])]));
  return { data, columns, available: new Set(tableNames) };
}

test('checksum canoniza propiedades y fechas a ISO', () => {
  const date = new Date('2026-10-25T10:00:00.000Z');
  assert.equal(
    backupService.checksumFor({ date, value: 1 }),
    backupService.checksumFor({ value: 1, date: '2026-10-25T10:00:00.000Z' })
  );
});

test('crea exportación con conteos, versión, checksum y registro de auditoría', async () => {
  const originalQuery = db.query;
  const originalTransaction = db.transaction;
  db.transaction = async (callback) => callback({
    async query(sql) {
      if (sql.includes('information_schema.tables')) return { rows: tableNames.map((table_name) => ({ table_name })) };
      if (sql.includes('FROM schema_migrations')) return { rows: [{ version: '006-admin-backup-audit.sql' }] };
      const table = sql.match(/^SELECT \* FROM "([^"]+)"$/)?.[1];
      if (table === 'users') return { rows: [{ id: '1', rol: 'admin', created_at: new Date('2026-10-25T10:00:00.000Z') }], rowCount: 1 };
      if (table) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }
  });
  let auditEntry;
  db.query = async (_sql, params) => {
    auditEntry = params;
    return { rowCount: 1, rows: [] };
  };
  try {
    const result = await backupService.createBackup({ id: '42' });
    const parsed = JSON.parse(result.content);
    const { checksum, ...document } = parsed;
    assert.equal(parsed.metadata.formato, 'netmo-backup');
    assert.equal(parsed.metadata.version_esquema, '006-admin-backup-audit.sql');
    assert.equal(parsed.metadata.conteos.users, 1);
    assert.equal(parsed.data.users[0].created_at, '2026-10-25T10:00:00.000Z');
    assert.equal(checksum, backupService.checksumFor(document));
    assert.match(result.filename, /^netmo-backup-\d{8}-\d{4}\.json$/);
    assert.deepEqual(auditEntry, ['42', JSON.stringify(parsed.metadata.conteos)]);
  } finally {
    db.query = originalQuery;
    db.transaction = originalTransaction;
  }
});

test('valida filas, enum y al menos un admin', () => {
  const backup = createValidBackup();
  assert.doesNotThrow(() => backupService.validateRows(backup, backup.available, backup.columns));
  backup.data.users[0].rol = 'superadmin';
  assert.throws(() => backupService.validateRows(backup, backup.available, backup.columns), /Tipo o valor inválido/);
  backup.data.users[0].rol = 'alumno';
  assert.throws(() => backupService.validateRows(backup, backup.available, backup.columns), /al menos un administrador/);
});

test('el backup admite hora prevista nula en devoluciones históricas', () => {
  const backup = createValidBackup();
  backup.data.notebooks = [{ id: '10', codigo: 'NB-010', estado: 'disponible', ubicacion: 'Carro 1' }];
  backup.data.loans = [{
    id: '9', notebook_id: '10', user_id: '1', vence_at: '2026-10-25T17:30:00.000Z', estado: 'activo'
  }];
  backup.data.returns = [{ id: '7', loan_id: '9', hora_prevista: null }];
  assert.doesNotThrow(() => backupService.validateRows(
    { data: backup.data },
    backup.available,
    backup.columns
  ));
});

test('rechaza referencias inconsistentes en datos de backup', () => {
  const backup = createValidBackup();
  backup.data.reservations.push({
    id: '22',
    codigo: 'RES-22',
    owner_id: '999',
    tipo: 'individual',
    cantidad: 1,
    retiro_at: '2026-10-26T13:00:00.000Z',
    estado: 'confirmada'
  });
  assert.throws(() => backupService.validateRows(backup, backup.available, backup.columns), /Referencia inválida/);
});

test('acepta el esquema inicial y reconoce versiones de migración', () => {
  assert.equal(backupService.migrationNumber('000-initial-schema'), 0);
  assert.equal(backupService.migrationNumber('006-admin-backup-audit.sql'.replace('.sql', '')), 6);
  assert.equal(backupService.migrationNumber('future'), null);
});
