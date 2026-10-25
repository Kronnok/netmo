function databaseParts(value) {
  try {
    const url = new URL(value);
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || '5432',
      database: decodeURIComponent(url.pathname.slice(1)).toLowerCase()
    };
  } catch {
    return null;
  }
}

function testDatabaseError(env = process.env) {
  const testUrl = env.TEST_DATABASE_URL;
  if (!testUrl) return 'Falta TEST_DATABASE_URL.';
  if (env.DATABASE_URL && testUrl === env.DATABASE_URL) {
    return 'TEST_DATABASE_URL no puede ser igual a DATABASE_URL.';
  }
  const test = databaseParts(testUrl);
  if (!test || !['postgres:', 'postgresql:'].includes(new URL(testUrl).protocol)) {
    return 'TEST_DATABASE_URL no es una URL PostgreSQL válida.';
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const isLocal = localHosts.has(test.host);
  if (!isLocal && !/(^|[_-])test([_-]|$)/i.test(test.database)) {
    return 'La base de test remota debe tener "test" en su nombre.';
  }
  if (env.DATABASE_URL) {
    const production = databaseParts(env.DATABASE_URL);
    if (production && production.host === test.host && production.port === test.port
        && production.database === test.database) {
      return 'TEST_DATABASE_URL apunta a la misma base configurada como DATABASE_URL.';
    }
  }
  return null;
}

module.exports = { testDatabaseError };
