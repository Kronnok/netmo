const crypto = require('node:crypto');
const db = require('../data/database');
const { AppError } = require('../errors');

const FORMAT = 'netmo-backup';

const TABLES = [
  'users',
  'user_preferences',
  'carros',
  'notebooks',
  'reservations',
  'reservation_notebooks',
  'loans',
  'returns',
  'tickets',
  'late_returns'
];

const RESTORE_ORDER = [
  'returns',
  'late_returns',
  'reservation_notebooks',
  'tickets',
  'loans',
  'reservations',
  'notebooks',
  'user_preferences',
  'carros',
  'users'
];

const SERIAL_TABLES = ['users', 'notebooks', 'reservations', 'loans', 'returns', 'tickets', 'late_returns'];

const REQUIRED_FIELDS = {
  users: ['id', 'legajo', 'nombre', 'email', 'rol', 'password_hash'],
  user_preferences: ['user_id'],
  carros: ['numero'],
  notebooks: ['id', 'codigo', 'estado', 'ubicacion'],
  reservations: ['id', 'codigo', 'owner_id', 'tipo', 'cantidad', 'retiro_at', 'estado'],
  reservation_notebooks: ['reservation_id', 'notebook_id'],
  loans: ['id', 'notebook_id', 'user_id', 'vence_at', 'estado'],
  returns: ['id', 'loan_id'],
  tickets: ['id', 'codigo', 'owner_id', 'motivo', 'descripcion', 'estado'],
  late_returns: ['id', 'loan_id', 'user_id', 'notebook_id', 'returned_at', 'due_at']
};

const ENUMS = {
  'users.rol': ['alumno', 'profesor', 'admin'],
  'notebooks.estado': ['disponible', 'prestada', 'mantenimiento', 'pendiente_devolucion'],
  'reservations.tipo': ['individual', 'lote'],
  'reservations.estado': ['confirmada', 'pendiente_aprobacion', 'aprobada', 'retirada', 'rechazada', 'cancelada'],
  'loans.estado': ['activo', 'devolucion_pendiente', 'devuelto'],
  'returns.estado': ['pendiente', 'confirmada'],
  'tickets.estado': ['abierto', 'progreso', 'resuelto']
};

const NULLABLE_FIELDS = new Set([
  'users.baneado_hasta',
  'notebooks.carro_id', 'notebooks.prestado_a',
  'reservations.carro', 'reservations.curso', 'reservations.hora_devolucion',
  'loans.reservation_id', 'loans.curso', 'loans.devuelta_at',
  'returns.hora_prevista', 'returns.confirmado_at', 'returns.confirmado_por',
  'tickets.notebook_id', 'tickets.resolved_at', 'tickets.resolved_by',
  'audit_log.user_id'
]);

const TYPE_OVERRIDES = {
  'users.baneado': 'boolean',
  'user_preferences.email_notifications': 'boolean',
  'reservation_notebooks.active': 'boolean',
  'users.rol': 'enum',
  'notebooks.estado': 'enum',
  'reservations.tipo': 'enum',
  'reservations.estado': 'enum',
  'loans.estado': 'enum',
  'returns.estado': 'enum',
  'tickets.estado': 'enum'
};

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function checksumFor(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function migrationNumber(version) {
  const match = typeof version === 'string' && version.match(/^(\d{3})-[a-z0-9-]+$/);
  return match ? Number(match[1]) : null;
}

async function latestSchemaVersion(client = db) {
  const result = await client.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1");
  return result.rows[0]?.version || '000-initial-schema';
}

async function existingTables(client = db) {
  const result = await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [TABLES]);
  return new Set(result.rows.map((row) => row.table_name));
}

function timestampForFilename(date) {
  const parts = date.toISOString().replace(/[-:T]/g, '');
  return `netmo-backup-${parts.slice(0, 8)}-${parts.slice(8, 12)}.json`;
}

async function createBackup(user) {
  const payload = await db.transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const availableTables = await existingTables(client);
    const data = {};
    const conteos = {};
    for (const table of TABLES) {
      if (!availableTables.has(table)) {
        if (table !== 'carros') throw new Error(`No existe la tabla requerida ${table}`);
        continue;
      }
      const result = await client.query(`SELECT * FROM "${table}"`);
      data[table] = result.rows;
      conteos[table] = result.rowCount;
    }
    const fecha = new Date();
    const metadata = {
      formato: FORMAT,
      version_esquema: await latestSchemaVersion(client),
      fecha: fecha.toISOString(),
      conteos
    };
    return { metadata, data, filename: timestampForFilename(fecha) };
  });

  await db.query(`INSERT INTO audit_log (user_id, accion, detalle)
    VALUES ($1, 'backup', $2)`, [user.id, JSON.stringify(payload.metadata.conteos)]);
  const document = { metadata: payload.metadata, data: payload.data };
  return {
    filename: payload.filename,
    content: JSON.stringify({ ...document, checksum: checksumFor(document) })
  };
}

function isInteger(value) {
  return (typeof value === 'number' && Number.isSafeInteger(value))
    || (typeof value === 'string' && /^\d+$/.test(value));
}

function isTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function expectedType(table, key) {
  const override = TYPE_OVERRIDES[`${table}.${key}`];
  if (override) return override;
  if (key === 'id' || key.endsWith('_id') || key === 'numero' || key === 'cantidad' || key === 'return_reminder_minutes') return 'integer';
  if (key.endsWith('_at') || key === 'created_at' || key === 'updated_at') return 'timestamp';
  return 'string';
}

function validateValue(table, key, value) {
  if (value === null) {
    if (NULLABLE_FIELDS.has(`${table}.${key}`)) return;
    throw new AppError(`El campo ${table}.${key} no admite valor nulo.`, 400);
  }
  const type = expectedType(table, key);
  const valid = type === 'boolean' ? typeof value === 'boolean'
    : type === 'integer' ? isInteger(value)
      : type === 'timestamp' ? isTimestamp(value)
        : type === 'enum' ? ENUMS[`${table}.${key}`].includes(value)
          : typeof value === 'string';
  if (!valid) throw new AppError(`Tipo o valor inválido en ${table}.${key}.`, 400);
}

function assertUnique(rows, key, table) {
  const seen = new Set();
  for (const row of rows) {
    if (row[key] === undefined || row[key] === null) continue;
    const normalized = String(row[key]).toLowerCase();
    if (seen.has(normalized)) throw new AppError(`Hay valores duplicados en ${table}.${key}.`, 400);
    seen.add(normalized);
  }
}

function validateRows(backup, availableTables, columnsByTable) {
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    throw new AppError('El backup no contiene tablas de datos válidas.', 400);
  }
  if (Object.keys(backup.data).some((table) => !TABLES.includes(table))) {
    throw new AppError('El backup contiene tablas no reconocidas.', 400);
  }
  for (const table of TABLES) {
    if (table === 'carros' && !availableTables.has(table) && backup.data[table] === undefined) continue;
    if (!Array.isArray(backup.data[table])) throw new AppError(`La tabla ${table} debe ser una lista.`, 400);
    for (const [index, row] of backup.data[table].entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new AppError(`La fila ${index + 1} de ${table} no es un objeto válido.`, 400);
      }
      for (const field of REQUIRED_FIELDS[table]) {
        if (row[field] === undefined || row[field] === null) {
          throw new AppError(`Falta el campo requerido ${table}.${field}.`, 400);
        }
      }
      const knownColumns = columnsByTable[table];
      for (const [key, value] of Object.entries(row)) {
        if (knownColumns.has(key)) validateValue(table, key, value);
      }
    }
  }
  const users = backup.data.users;
  if (!users.some((row) => row.rol === 'admin')) throw new AppError('El backup debe incluir al menos un administrador.', 400);
  for (const [table, key] of [
    ['users', 'id'], ['users', 'legajo'], ['users', 'email'], ['user_preferences', 'user_id'],
    ['notebooks', 'id'], ['notebooks', 'codigo'],
    ['reservations', 'id'], ['reservations', 'codigo'], ['loans', 'id'], ['returns', 'id'],
    ['returns', 'loan_id'], ['tickets', 'id'], ['tickets', 'codigo'], ['late_returns', 'id'],
    ['late_returns', 'loan_id'], ['carros', 'numero']
  ]) assertUnique(backup.data[table] || [], key, table);

  const ids = Object.fromEntries(['users', 'notebooks', 'reservations', 'loans', 'returns'].map((table) => [
    table,
    new Set((backup.data[table] || []).map((row) => String(row.id)))
  ]));
  const carIds = new Set((backup.data.carros || []).map((row) => String(row.numero)));
  const refs = [
    ['user_preferences', 'user_id', 'users', false],
    ['notebooks', 'carro_id', 'carros', true],
    ['notebooks', 'prestado_a', 'users', true],
    ['reservations', 'owner_id', 'users', false],
    ['reservation_notebooks', 'reservation_id', 'reservations', false],
    ['reservation_notebooks', 'notebook_id', 'notebooks', false],
    ['loans', 'notebook_id', 'notebooks', false],
    ['loans', 'user_id', 'users', false],
    ['loans', 'reservation_id', 'reservations', true],
    ['returns', 'loan_id', 'loans', false],
    ['returns', 'confirmado_por', 'users', true],
    ['tickets', 'notebook_id', 'notebooks', true],
    ['tickets', 'owner_id', 'users', false],
    ['tickets', 'resolved_by', 'users', true],
    ['late_returns', 'loan_id', 'loans', false],
    ['late_returns', 'user_id', 'users', false],
    ['late_returns', 'notebook_id', 'notebooks', false]
  ];
  for (const [table, field, target, nullable] of refs) {
    for (const row of backup.data[table] || []) {
      if (row[field] === undefined && nullable) continue;
      if (row[field] === null && nullable) continue;
      const targetIds = target === 'carros' ? carIds : ids[target];
      if (!targetIds.has(String(row[field]))) throw new AppError(`Referencia inválida en ${table}.${field}.`, 400);
    }
  }
}

async function tableColumns(client, table) {
  const result = await client.query(`SELECT column_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position`, [table]);
  return result.rows;
}

async function insertRows(client, table, rows) {
  if (!rows.length) return;
  const columns = await tableColumns(client, table);
  if (!columns.length) throw new AppError(`No existe la tabla ${table} en la base actual.`, 400);
  const allowedColumns = new Set(columns.map((column) => column.column_name));
  const groups = new Map();
  for (const row of rows) {
    const values = Object.keys(row).filter((key) => allowedColumns.has(key)).sort();
    for (const column of columns) {
      if (values.includes(column.column_name)) continue;
      if (column.is_nullable === 'NO' && column.column_default === null) {
        throw new AppError(`El backup no incluye la columna requerida ${table}.${column.column_name}.`, 400);
      }
    }
    const key = values.join(',');
    if (!groups.has(key)) groups.set(key, { columns: values, rows: [] });
    groups.get(key).rows.push(row);
  }

  for (const group of groups.values()) {
    if (!group.columns.length) continue;
    const quotedColumns = group.columns.map((column) => `"${column}"`).join(', ');
    for (let offset = 0; offset < group.rows.length; offset += 500) {
      const chunk = group.rows.slice(offset, offset + 500);
      const parameters = [];
      const tuples = chunk.map((row) => `(${group.columns.map((column) => {
        parameters.push(row[column] === undefined ? null : row[column]);
        return `$${parameters.length}`;
      }).join(', ')})`);
      await client.query(`INSERT INTO "${table}" (${quotedColumns}) VALUES ${tuples.join(', ')}`, parameters);
    }
  }
}

async function restoreBackup(body, user) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('La solicitud debe ser un objeto JSON.', 400);
  const { backup, password, confirmation } = body;
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new AppError('El archivo de backup no es válido.', 400);
  const latestVersion = await latestSchemaVersion();
  const backupMetadata = backup.metadata;
  if (!backupMetadata || backupMetadata.formato !== FORMAT) throw new AppError('Formato de backup no reconocido.', 400);
  const backupVersion = migrationNumber(backupMetadata.version_esquema);
  const currentVersion = migrationNumber(latestVersion);
  if (backupVersion === null || currentVersion === null) throw new AppError('La versión del esquema del backup no es válida.', 400);
  if (backupVersion > currentVersion || (backupVersion === currentVersion && backupMetadata.version_esquema !== latestVersion)) {
    throw new AppError('El backup fue creado con una versión de esquema posterior a la actual.', 400);
  }
  if (typeof backup.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(backup.checksum)) {
    throw new AppError('El checksum del backup no es válido.', 400);
  }
  const document = { metadata: backup.metadata, data: backup.data };
  const expected = Buffer.from(checksumFor(document), 'hex');
  const supplied = Buffer.from(backup.checksum, 'hex');
  if (!crypto.timingSafeEqual(expected, supplied)) throw new AppError('El checksum no coincide; el backup está dañado o fue modificado.', 400);
  if (backupVersion < 3 && backup.data && backup.data.carros === undefined) {
    backup.data.carros = [];
    backupMetadata.conteos = { ...backupMetadata.conteos, carros: 0 };
  }
  const availableTables = await existingTables();
  const columnsByTable = {};
  for (const table of TABLES) {
    if (!availableTables.has(table)) continue;
    columnsByTable[table] = new Set((await tableColumns(db.pool, table)).map((column) => column.column_name));
  }
  validateRows(backup, availableTables, columnsByTable);
  if (!backupMetadata.conteos || typeof backupMetadata.conteos !== 'object' || Array.isArray(backupMetadata.conteos)) {
    throw new AppError('Los conteos del backup no son válidos.', 400);
  }
  if (!isTimestamp(backupMetadata.fecha)) throw new AppError('La fecha del backup no es válida.', 400);
  const allowedCountTables = new Set(TABLES);
  if (Object.keys(backupMetadata.conteos).some((table) => !allowedCountTables.has(table))) {
    throw new AppError('El backup informa conteos para tablas no reconocidas.', 400);
  }
  for (const table of Object.keys(backup.data)) {
    const count = backupMetadata.conteos[table];
    if (!Number.isInteger(count) || count !== (backup.data[table] || []).length) {
      throw new AppError(`El conteo informado para ${table} no coincide con sus datos.`, 400);
    }
  }
  const normalizedConfirmation = typeof confirmation === 'string' ? confirmation.trim() : '';
  if (!normalizedConfirmation) throw new AppError('La confirmación no puede estar vacía.', 400);
  if (normalizedConfirmation.length > 50) {
    throw new AppError('La confirmación no puede superar 50 caracteres.', 400);
  }
  if (normalizedConfirmation !== 'RESTAURAR') throw new AppError('La frase de confirmación debe ser exactamente RESTAURAR.', 400);
  if (typeof password !== 'string' || !password.trim()) throw new AppError('Ingresá tu contraseña actual.', 400);
  if (password.length > 50) throw new AppError('La contraseña actual no puede superar 50 caracteres.', 400);

  try {
    await db.transaction(async (client) => {
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(781904221, 1) AS locked');
      if (!lock.rows[0].locked) throw new AppError('Ya hay otra restauración en curso.', 409);
      const passwordResult = await client.query(`SELECT password_hash = crypt($1, password_hash) AS valid
        FROM users WHERE id = $2 AND rol = 'admin'`, [password, user.id]);
      if (!passwordResult.rows[0]?.valid) throw new AppError('La contraseña actual no es correcta.', 403);
      await client.query("SELECT set_config('netmo.restore_mode', 'on', true)");

      for (const table of RESTORE_ORDER) {
        if (!availableTables.has(table)) {
          if (table === 'carros' && !(backup.data.carros || []).length) continue;
          throw new AppError(`No existe la tabla ${table} en la base actual.`, 400);
        }
        await client.query(`DELETE FROM "${table}"`);
      }
      for (const table of RESTORE_ORDER.slice().reverse()) {
        if (!availableTables.has(table)) continue;
        await insertRows(client, table, backup.data[table] || []);
      }
      for (const table of SERIAL_TABLES) {
        if (!availableTables.has(table)) continue;
        await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'),
          COALESCE(MAX(id), 1), COUNT(*) > 0) FROM "${table}"`, [table]);
      }
      const restoredActor = (backup.data.users || []).some((row) =>
        String(row.id) === String(user.id) && row.rol === 'admin'
          && row.email.toLowerCase() === String(user.email).toLowerCase())
        ? user.id
        : null;
      await client.query(`INSERT INTO audit_log (user_id, accion, detalle)
        VALUES ($1, 'restore', $2)`, [restoredActor, JSON.stringify(backupMetadata.conteos || {})]);
    });
  } catch (error) {
    if (error.status) throw error;
    throw new AppError('La restauración falló y todos los cambios fueron revertidos. Verificá que el backup sea compatible con el esquema actual.', 400);
  }
  return { message: 'Backup restaurado correctamente.' };
}

module.exports = { createBackup, restoreBackup, checksumFor, validateRows, migrationNumber };
