const fs = require('node:fs');
const path = require('node:path');

const rootEnv = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function main() {
  const to = process.argv[2];
  if (!to || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(to)) {
    throw new Error('Uso: npm run mail:test -- destino@correo.com');
  }
  const { sendMail } = require('../services/mail-service');
  await sendMail({
    to,
    subject: 'Prueba de correo de NetMO',
    html: '<p>El servicio de correo de NetMO está configurado correctamente.</p>'
  });
  console.log('OK: correo de prueba enviado.');
}

main().catch((error) => {
  console.error(`FALLA: ${error.message}`);
  process.exitCode = 1;
});
