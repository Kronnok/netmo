const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sendMail } = require('../services/mail-service');

async function withMailEnvironment(overrides, callback) {
  const names = new Set(['NODE_ENV', ...Object.keys(overrides)]);
  const original = new Map([...names].map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const originalInfo = console.info;
  for (const name of names) {
    if (Object.hasOwn(overrides, name)) process.env[name] = overrides[name];
    else delete process.env[name];
  }
  try {
    await callback();
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    global.fetch = originalFetch;
    console.info = originalInfo;
  }
}

test('GAS envía JSON, sigue redirecciones y requiere respuesta ok', async () => {
  await withMailEnvironment({
    NODE_ENV: 'production',
    MAIL_PROVIDER: 'gas',
    MAIL_GAS_URL: 'https://script.example.test/exec',
    MAIL_GAS_SECRET: 'unit-test-secret',
    MAIL_FROM_EMAIL: 'netmo@example.test',
    MAIL_FROM_NAME: 'NetMO'
  }, async () => {
    global.fetch = async (url, options) => {
      assert.equal(url, process.env.MAIL_GAS_URL);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'follow');
      assert.deepEqual(JSON.parse(options.body), {
        secret: process.env.MAIL_GAS_SECRET,
        to: 'person@example.test',
        subject: 'Aviso',
        html: '<p>Prueba</p>'
      });
      return { ok: true, async text() { return 'ok'; } };
    };
    await sendMail({ to: 'person@example.test', subject: 'Aviso', html: '<p>Prueba</p>' });
  });
});

test('Brevo usa api-key y requiere respuesta HTTP satisfactoria', async () => {
  await withMailEnvironment({
    NODE_ENV: 'production',
    MAIL_PROVIDER: 'brevo',
    MAIL_API_KEY: 'unit-test-api-key',
    MAIL_FROM_EMAIL: 'netmo@example.test',
    MAIL_FROM_NAME: 'NetMO'
  }, async () => {
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(options.headers['api-key'], process.env.MAIL_API_KEY);
      assert.deepEqual(JSON.parse(options.body), {
        sender: { email: 'netmo@example.test', name: 'NetMO' },
        to: [{ email: 'person@example.test' }],
        subject: 'Aviso',
        htmlContent: '<p>Prueba</p>'
      });
      return { ok: false, status: 503 };
    };
    await assert.rejects(
      sendMail({ to: 'person@example.test', subject: 'Aviso', html: '<p>Prueba</p>' }),
      /HTTP 503/
    );
  });
});

test('console solo se permite en desarrollo y no requiere remitente', async () => {
  await withMailEnvironment({ NODE_ENV: 'development', MAIL_PROVIDER: 'console' }, async () => {
    let printed = false;
    console.info = () => { printed = true; };
    await sendMail({ to: 'person@example.test', subject: 'Aviso', html: '<p>Prueba</p>' });
    assert.equal(printed, true);
  });
  await withMailEnvironment({ NODE_ENV: 'production', MAIL_PROVIDER: 'console' }, async () => {
    await assert.rejects(
      sendMail({ to: 'person@example.test', subject: 'Aviso', html: '<p>Prueba</p>' }),
      /solo está permitido en desarrollo/
    );
  });
});

test('GAS rechaza respuestas distintas de ok y faltantes de configuración', async () => {
  await withMailEnvironment({
    NODE_ENV: 'production',
    MAIL_PROVIDER: 'gas',
    MAIL_GAS_URL: 'https://script.example.test/exec',
    MAIL_GAS_SECRET: 'unit-test-secret',
    MAIL_FROM_EMAIL: 'netmo@example.test',
    MAIL_FROM_NAME: 'NetMO'
  }, async () => {
    global.fetch = async () => ({ ok: true, async text() { return 'not ok'; } });
    await assert.rejects(
      sendMail({ to: 'person@example.test', subject: 'Aviso', html: '<p>Prueba</p>' }),
      /respuesta no válida/
    );
    delete process.env.MAIL_GAS_SECRET;
    await assert.rejects(
      sendMail({ to: 'person@example.test', subject: 'Aviso', html: '<p>Prueba</p>' }),
      /MAIL_GAS_URL y MAIL_GAS_SECRET/
    );
  });
});
