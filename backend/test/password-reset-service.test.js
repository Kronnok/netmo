const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.JWT_SECRET = 'password-reset-test-secret-with-at-least-32-bytes';
process.env.NODE_ENV = 'development';
process.env.MAIL_PROVIDER = 'console';

const db = require('../data/database');
const rateLimiter = require('../services/login-rate-limiter');
const { requestForgot, resetPassword, requestChange, changePassword } = require('../services/password-reset-service');

async function withResetStore({ exists = true, email = 'legacy@example.test' } = {}, callback) {
  const originalTransaction = db.transaction;
  const originalInfo = console.info;
  const originalError = console.error;
  const state = {
    user: exists ? { id: '44', email } : null,
    reset: null,
    passwordChanged: false,
    currentPasswordValid: true,
    invalidated: false,
    transactions: 0
  };
  let issuedEmail;
  db.transaction = async (operation) => {
    state.transactions += 1;
    return operation({
      query: async (sql, params = []) => {
        if (sql.includes('SELECT id, email FROM users')) {
          return state.user ? { rowCount: 1, rows: [state.user] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id FROM users') && sql.includes('password_hash = crypt')) {
          return state.currentPasswordValid ? { rowCount: 1, rows: [{ id: state.user.id }] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT id FROM users WHERE id = $1 FOR UPDATE')) {
          return state.user ? { rowCount: 1, rows: [{ id: state.user.id }] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT 1 FROM password_resets')) return { rowCount: 0, rows: [] };
        if (sql.includes('INSERT INTO password_resets')) {
          state.reset = {
            id: '8',
            code_hash: params[1],
            attempts: 0,
            expires_at: new Date(Date.now() + 10 * 60_000),
            used_at: null
          };
          return { rowCount: 1, rows: [{ id: '8' }] };
        }
        if (sql.includes('SELECT id FROM users WHERE email')) {
          return state.user ? { rowCount: 1, rows: [{ id: state.user.id }] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM password_resets WHERE user_id')) {
          return state.reset ? { rowCount: 1, rows: [state.reset] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET attempts =')) {
          state.reset.attempts = params[0];
          if (state.reset.attempts >= 5) state.reset.used_at = new Date();
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE users SET password_hash')) {
          state.passwordChanged = true;
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('WHERE user_id = $1 AND used_at IS NULL')) {
          state.invalidated = true;
          if (state.reset) state.reset.used_at = new Date();
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('UPDATE password_resets SET used_at')) {
          if (state.reset && params[0] === state.reset.id) state.reset.used_at = new Date();
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Consulta no prevista: ${sql}`);
      }
    });
  };
  const originalQuery = db.query;
  db.query = async (sql, params = []) => {
    if (sql.includes('UPDATE password_resets SET used_at') && sql.includes('WHERE id = $1')) {
      state.invalidated = true;
      if (state.reset) state.reset.used_at = new Date();
      return { rowCount: 1, rows: [] };
    }
    return originalQuery.call(db, sql, params);
  };
  console.info = (...args) => { issuedEmail = args; };
  console.error = () => {};
  rateLimiter.reset();
  try {
    await callback({
      state,
      getCode: () => {
        const html = issuedEmail?.[1]?.html || '';
        return html.match(/\b\d{6}\b/)?.[0];
      }
    });
  } finally {
    db.transaction = originalTransaction;
    db.query = originalQuery;
    console.info = originalInfo;
    console.error = originalError;
    rateLimiter.reset();
  }
}

function request(ip = '192.0.2.44') {
  return { headers: {}, socket: { remoteAddress: ip } };
}

test('forgot responde igual para correo registrado y no registrado', async () => {
  await withResetStore({}, async () => {
    const known = await requestForgot({ email: 'legacy@example.test' }, request());
    await withResetStore({ exists: false }, async () => {
      const unknown = await requestForgot({ email: 'legacy@example.test' }, request());
      assert.deepEqual(unknown, known);
    });
    assert.deepEqual(known, {
      message: 'Si el correo está registrado, recibirás instrucciones para continuar.'
    });
  });
});

test('el código correcto permite actualizar la contraseña de un dominio histórico', async () => {
  await withResetStore({}, async ({ state, getCode }) => {
    await requestForgot({ email: 'legacy@example.test' }, request());
    const code = getCode();
    assert.match(code, /^\d{6}$/);
    const result = await resetPassword({
      email: 'legacy@example.test', code, password: 'new-password-123'
    }, request());
    assert.equal(result.message, 'La contraseña se actualizó correctamente.');
    assert.equal(state.passwordChanged, true);
    assert.ok(state.reset.used_at);
  });
});

test('rechaza código incorrecto, vencido y reutilizado', async () => {
  await withResetStore({}, async ({ state, getCode }) => {
    await requestForgot({ email: 'legacy@example.test' }, request());
    const code = getCode();
    const wrongCode = code === '000000' ? '000001' : '000000';
    await assert.rejects(
      resetPassword({ email: 'legacy@example.test', code: wrongCode, password: 'new-password-123' }, request()),
      (error) => error.status === 400 && /No se pudo restablecer/.test(error.message)
    );
    state.reset.expires_at = new Date(Date.now() - 1);
    await assert.rejects(
      resetPassword({ email: 'legacy@example.test', code, password: 'new-password-123' }, request()),
      (error) => error.status === 400
    );
    state.reset.expires_at = new Date(Date.now() + 10 * 60_000);
    state.reset.used_at = null;
    await resetPassword({ email: 'legacy@example.test', code, password: 'new-password-123' }, request());
    await assert.rejects(
      resetPassword({ email: 'legacy@example.test', code, password: 'new-password-123' }, request()),
      (error) => error.status === 400
    );
  });
});

test('cinco códigos incorrectos agotan intentos, se limita el pedido y valida la contraseña', async () => {
  await withResetStore({}, async ({ state }) => {
    const req = request();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await requestForgot({ email: 'legacy@example.test' }, req);
    }
    const beforeLimitedRequest = state.transactions;
    const generic = await requestForgot({ email: 'legacy@example.test' }, req);
    assert.equal(generic.message, 'Si el correo está registrado, recibirás instrucciones para continuar.');
    assert.equal(state.transactions, beforeLimitedRequest);
  });

  await withResetStore({}, async ({ state, getCode }) => {
    const req = request();
    await requestForgot({ email: 'legacy@example.test' }, req);
    const code = getCode();
    const beforeInvalidPassword = state.transactions;
    await assert.rejects(
      resetPassword({ email: 'legacy@example.test', code, password: 'has space' }, req),
      (error) => error.status === 400 && /8 y 50 caracteres/.test(error.message)
    );
    assert.equal(state.transactions, beforeInvalidPassword);
    const attemptsRequest = request('192.0.2.45');
    const wrongCode = code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(
        resetPassword({ email: 'legacy@example.test', code: wrongCode, password: 'new-password-123' }, attemptsRequest),
        (error) => error.status === 400
      );
    }
    assert.equal(state.reset.attempts, 5);
    assert.ok(state.reset.used_at);
  });
});

test('forgot mantiene la respuesta genérica e invalida el código si el correo falla', async () => {
  await withResetStore({}, async ({ state }) => {
    const originalProvider = process.env.MAIL_PROVIDER;
    const originalKey = process.env.MAIL_API_KEY;
    process.env.MAIL_PROVIDER = 'brevo';
    delete process.env.MAIL_API_KEY;
    try {
      const response = await requestForgot({ email: 'legacy@example.test' }, request());
      assert.equal(response.message, 'Si el correo está registrado, recibirás instrucciones para continuar.');
      assert.equal(state.invalidated, true);
      assert.ok(state.reset?.used_at);
    } finally {
      process.env.MAIL_PROVIDER = originalProvider;
      if (originalKey === undefined) delete process.env.MAIL_API_KEY;
      else process.env.MAIL_API_KEY = originalKey;
    }
  });
});

test('el cambio autenticado responde 503 e invalida el código si el correo falla', async () => {
  await withResetStore({}, async ({ state }) => {
    const originalProvider = process.env.MAIL_PROVIDER;
    const originalKey = process.env.MAIL_API_KEY;
    process.env.MAIL_PROVIDER = 'brevo';
    delete process.env.MAIL_API_KEY;
    try {
      await assert.rejects(
        requestChange({}, { id: '44', email: 'legacy@example.test' }, request()),
        (error) => error.status === 503 && /No se pudo enviar el código/.test(error.message)
      );
      assert.equal(state.invalidated, true);
      assert.ok(state.reset?.used_at);
    } finally {
      process.env.MAIL_PROVIDER = originalProvider;
      if (originalKey === undefined) delete process.env.MAIL_API_KEY;
      else process.env.MAIL_API_KEY = originalKey;
    }
  });
});

test('cambia la contraseña con la contraseña actual sin depender del correo', async () => {
  await withResetStore({}, async ({ state }) => {
    const user = { id: '44', email: 'legacy@example.test' };
    const changed = await changePassword({
      currentPassword: 'old-password-123', password: 'new-password-123'
    }, user, request());
    assert.equal(changed.message, 'La contraseña se actualizó correctamente.');
    assert.equal(state.passwordChanged, true);
    assert.equal(state.invalidated, true);

    state.passwordChanged = false;
    state.currentPasswordValid = false;
    await assert.rejects(
      changePassword({ currentPassword: 'wrong-password', password: 'new-password-123' }, user, request('192.0.2.46')),
      (error) => error.status === 400 && /contraseña actual no es correcta/i.test(error.message)
    );
    assert.equal(state.passwordChanged, false);
  });
});
