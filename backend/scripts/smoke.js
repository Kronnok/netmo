const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { testDatabaseError } = require('./database-safety');

const root = path.resolve(__dirname, '..', '..');
function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  });
  return result.status === 0;
}

if (!run('static-checks.js')) process.exitCode = 1;
const error = testDatabaseError();
if (error) {
  if (error === 'Falta TEST_DATABASE_URL.') {
    console.log('Omitido (falta TEST_DATABASE_URL): smoke HTTP contra PostgreSQL.');
  } else {
    console.error(`FALLA seguridad de base de test: ${error}`);
    process.exitCode = 1;
  }
} else if (!run('run-integration.js')) {
  process.exitCode = 1;
}
