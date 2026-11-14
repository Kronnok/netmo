function mailConfiguration() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const provider = process.env.MAIL_PROVIDER || (nodeEnv === 'production' ? '' : 'console');
  if (!['gas', 'console'].includes(provider)) {
    throw new Error('MAIL_PROVIDER debe ser gas o console');
  }
  if (provider === 'console' && nodeEnv === 'production') {
    throw new Error('MAIL_PROVIDER=console solo está permitido en desarrollo');
  }

  const fromEmail = process.env.MAIL_FROM_EMAIL?.trim();
  const fromName = process.env.MAIL_FROM_NAME?.trim();
  if (provider === 'gas' && (!fromEmail || !fromName)) {
    throw new Error('MAIL_FROM_EMAIL y MAIL_FROM_NAME son obligatorios para enviar correo');
  }
  if (provider === 'gas' && (!process.env.MAIL_GAS_URL || !process.env.MAIL_GAS_SECRET)) {
    throw new Error('MAIL_GAS_URL y MAIL_GAS_SECRET son obligatorios para el proveedor GAS');
  }
  return { provider, fromEmail, fromName };
}

async function sendMail({ to, subject, html }) {
  const { provider } = mailConfiguration();
  if (typeof to !== 'string' || !to || typeof subject !== 'string' || typeof html !== 'string') {
    throw new Error('Destinatario, asunto y contenido del correo son obligatorios');
  }

  if (provider === 'console') {
    console.info('Correo de desarrollo:', { to, subject, html });
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  const body = JSON.stringify({ secret: process.env.MAIL_GAS_SECRET, to, subject, html });
  let response;
  try {
    response = await fetch(process.env.MAIL_GAS_URL, {
      method: 'POST',
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('El proveedor de correo superó el tiempo máximo de 15 segundos');
    }
    throw new Error('No se pudo conectar con el proveedor de correo');
  }
  if (!response.ok) throw new Error(`El proveedor de correo respondió HTTP ${response.status}`);
  if ((await response.text()).trim() !== 'ok') {
    throw new Error('El proveedor GAS devolvió una respuesta no válida');
  }
}

module.exports = { sendMail };
