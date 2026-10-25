const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { test } = require('node:test');
const routes = require('../routes');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('resuelve rutas de API y sus parámetros', () => {
  assert.equal(routes.resolve('GET', '/api/notebooks').action, 'notebooks');
  assert.deepEqual(routes.resolve('POST', '/api/admin/reservations/42/checkout').params, { id: 42 });
  assert.equal(routes.resolve('POST', '/api/auth/register'), null);
  assert.equal(routes.resolve('POST', '/api/auth/forgot').action, 'forgotPassword');
  assert.equal(routes.resolve('POST', '/api/auth/reset').action, 'resetPassword');
  assert.equal(routes.resolve('POST', '/api/auth/change-password/request').action, 'requestPasswordChange');
  assert.equal(routes.resolve('POST', '/api/auth/change-password').action, 'changePassword');
  assert.equal(routes.resolve('POST', '/api/admin/users').action, 'createUser');
  assert.equal(routes.resolve('GET', '/api/admin/carros').action, 'carros');
  assert.equal(routes.resolve('GET', '/api/admin/backup').action, 'downloadAdminBackup');
  assert.equal(routes.resolve('POST', '/api/admin/restore').action, 'restoreAdminBackup');
  assert.equal(routes.resolve('POST', '/api/admin/carros').action, 'createCarro');
  assert.equal(routes.resolve('POST', '/api/admin/notebooks').action, 'createNotebooks');
  assert.equal(routes.resolve('GET', '/api/missing'), null);
});

test('sirve frontend en desarrollo, valida JSON y responde CORS', async (context) => {
  const port = await unusedPort();
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      JWT_SECRET: 'test-only-secret-that-is-long-enough-for-hmac',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/netmo',
      CORS_ORIGIN: 'https://frontend.test'
    },
    stdio: 'ignore'
  });
  context.after(() => child.kill());

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited with code ${child.exitCode}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (error) {
      if (attempt === 49) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'API de desarrollo no inició');

  const page = await fetch(baseUrl);
  assert.match(await page.text(), /NetMO/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await fetch(`${baseUrl}/app.js`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/styles.css`)).status, 200);

  const preflight = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://frontend.test', 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://frontend.test');

  const invalidJson = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{'
  });
  assert.equal(invalidJson.status, 400);
  assert.match((await invalidJson.json()).error, /JSON/);

  const publicRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Test', email: 'test@example.test', password: 'password' })
  });
  assert.equal(publicRegistration.status, 404);

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 500);
  assert.equal((await health.json()).error, 'Error interno del servidor');
});
