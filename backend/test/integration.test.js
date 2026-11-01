const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { testDatabaseError } = require('../scripts/database-safety');

const missingConfiguration = !process.env.TEST_DATABASE_URL;
const configurationError = testDatabaseError();

test('el runner rechaza una URL de test ausente, igual a producción o no aislada', () => {
  assert.match(testDatabaseError({}), /Falta TEST_DATABASE_URL/);
  assert.match(testDatabaseError({
    TEST_DATABASE_URL: 'postgresql://db.example/netmo',
    DATABASE_URL: 'postgresql://db.example/netmo'
  }), /no puede ser igual/);
  assert.match(testDatabaseError({
    TEST_DATABASE_URL: 'postgresql://test-db.example/netmo',
    DATABASE_URL: 'postgresql://prod-db.example/netmo'
  }), /debe tener "test" en su nombre/);
  assert.equal(testDatabaseError({
    TEST_DATABASE_URL: 'postgresql://localhost/netmo',
    DATABASE_URL: 'postgresql://prod-db.example/netmo'
  }), null);
});

if (missingConfiguration) {
  console.log('Omitidas (falta TEST_DATABASE_URL): pruebas de integración.');
  test('integración HTTP aislada', { skip: 'Omitida (falta TEST_DATABASE_URL)' }, () => {});
} else {
  test('integración HTTP aislada', async () => {
    assert.equal(configurationError, null, configurationError || undefined);
    const result = spawnSync(process.execPath, [
      path.resolve(__dirname, '..', 'scripts', 'run-integration.js')
    ], {
      cwd: path.resolve(__dirname, '..', '..'),
      env: process.env,
      encoding: 'utf8',
      timeout: 180_000
    });
    assert.equal(result.status, 0, result.stdout || 'Falló el runner aislado de integración.');
  });
}
