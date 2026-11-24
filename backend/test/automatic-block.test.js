const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  AUTOMATIC_BLOCK_DAYS,
  AUTOMATIC_BLOCK_THRESHOLD,
  activeBan,
  shouldBlockAutomatically
} = require('../services/automatic-block');

test('el bloqueo automático se activa recién con la quinta entrega tardía', () => {
  assert.equal(AUTOMATIC_BLOCK_THRESHOLD, 5);
  assert.equal(AUTOMATIC_BLOCK_DAYS, 7);
  for (let total = 0; total < 5; total += 1) {
    assert.equal(shouldBlockAutomatically({
      role: 'alumno', totalLateReturns: total, banned: false, banExpiresAt: null
    }), false, `${total} demoras no deben bloquear`);
  }
  for (const role of ['alumno', 'profesor']) {
    assert.equal(shouldBlockAutomatically({
      role, totalLateReturns: 5, banned: false, banExpiresAt: null
    }), true, `${role} debe bloquearse al llegar a 5`);
  }
  assert.equal(shouldBlockAutomatically({
    role: 'admin', totalLateReturns: 10, banned: false, banExpiresAt: null
  }), false, 'los administradores nunca se bloquean automáticamente');
});

test('un bloqueo vigente evita duplicar el bloqueo automático', () => {
  const now = new Date('2026-06-10T12:00:00.000Z');
  assert.equal(shouldBlockAutomatically({
    role: 'alumno', totalLateReturns: 6, banned: true, banExpiresAt: '2026-06-17T12:00:00.000Z'
  }, now), false);
  assert.equal(shouldBlockAutomatically({
    role: 'alumno', totalLateReturns: 6, banned: true, banExpiresAt: null
  }, now), false, 'un bloqueo indefinido tampoco se duplica');
  assert.equal(shouldBlockAutomatically({
    role: 'alumno', totalLateReturns: 6, banned: true, banExpiresAt: '2026-06-09T12:00:00.000Z'
  }, now), true, 'un bloqueo vencido permite volver a evaluar');
  assert.equal(activeBan(true, '2026-06-09T12:00:00.000Z', now), false);
  assert.equal(activeBan(true, '2026-06-17T12:00:00.000Z', now), true);
});

test('la migración 018 agrega el origen, el reinicio del contador y el umbral de 5', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = fs.readFileSync(
    path.join(root, 'database', 'migrations', '018-automatic-late-return-blocks.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(root, 'database', 'schema.sql'), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'backend', 'scripts', 'db.js'), 'utf8');
  const backup = fs.readFileSync(path.join(root, 'backend', 'services', 'backup-service.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'backend', 'services', 'api-service.js'), 'utf8');

  for (const source of [migration, schema]) {
    assert.match(source, /baneo_origen VARCHAR\(16\)/);
    assert.match(source, /tardanzas_reset_at TIMESTAMPTZ/);
    assert.match(source, /COUNT\(lr\.id\) >= 5 AS bloqueo_automatico/);
    assert.match(source, /lr\.returned_at >= u\.tardanzas_reset_at/);
  }
  assert.match(migration, /users_baneo_origen_check/);
  assert.match(runner, /'018-automatic-late-return-blocks\.sql'/);
  assert.match(backup, /'users\.baneo_origen'/);
  assert.match(backup, /'users\.tardanzas_reset_at'/);
  assert.match(api, /bloqueo_automatico/);
  assert.match(api, /baneo_origen = 'automatico'/);
  assert.match(api, /tardanzas_reset_at = CASE WHEN \$1 THEN tardanzas_reset_at ELSE now\(\) END/);
});
