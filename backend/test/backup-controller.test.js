const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { after, test } = require('node:test');

process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/netmo_backup_controller_test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-hmac';

const authService = require('../services/auth-service');
const backupService = require('../services/backup-service');
const controller = require('../controllers/api-controller');
const routes = require('../routes');

const originalAuthenticate = authService.authenticate;
const originalCreateBackup = backupService.createBackup;
const originalRestoreBackup = backupService.restoreBackup;
after(() => {
  authService.authenticate = originalAuthenticate;
  backupService.createBackup = originalCreateBackup;
  backupService.restoreBackup = originalRestoreBackup;
});

function makeRequest(method, url, body) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  request.method = method;
  request.url = url;
  request.headers = { authorization: 'Bearer unit-test-token' };
  return request;
}

function makeResponse() {
  return {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(payload) { this.payload = payload; }
  };
}

test('backup requiere admin y devuelve el archivo con Content-Disposition', async () => {
  authService.authenticate = async () => ({ id: '1', rol: 'admin' });
  backupService.createBackup = async () => ({
    filename: 'netmo-backup-20261025-1200.json',
    content: '{"checksum":"unit-test"}'
  });
  const response = makeResponse();
  await controller.handle(
    makeRequest('GET', '/api/admin/backup'),
    response,
    routes.resolve('GET', '/api/admin/backup'),
    {}
  );
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Disposition'], /netmo-backup-20261025-1200\.json/);
  assert.equal(response.payload, '{"checksum":"unit-test"}');
});

test('restore permite más de 1 MiB solo por la ruta admin y requiere admin', async () => {
  let restored = false;
  authService.authenticate = async () => ({ id: '1', rol: 'admin' });
  backupService.restoreBackup = async () => {
    restored = true;
    return { message: 'ok' };
  };
  const largeBody = JSON.stringify({ backup: {}, password: 'test', confirmation: 'RESTAURAR', padding: 'x'.repeat(1024 * 1024 + 16) });
  const response = makeResponse();
  await controller.handle(
    makeRequest('POST', '/api/admin/restore', largeBody),
    response,
    routes.resolve('POST', '/api/admin/restore'),
    {}
  );
  assert.equal(response.status, 200);
  assert.equal(restored, true);

  authService.authenticate = async () => ({ id: '2', rol: 'alumno' });
  const denied = makeResponse();
  await controller.handle(
    makeRequest('POST', '/api/admin/restore', '{}'),
    denied,
    routes.resolve('POST', '/api/admin/restore'),
    {}
  );
  assert.equal(denied.status, 403);
});

test('las demás rutas conservan el límite de cuerpo de 1 MiB', async () => {
  const response = makeResponse();
  await controller.handle(
    makeRequest('POST', '/api/auth/login', JSON.stringify({ padding: 'x'.repeat(1024 * 1024) })),
    response,
    routes.resolve('POST', '/api/auth/login'),
    {}
  );
  assert.equal(response.status, 413);
});
