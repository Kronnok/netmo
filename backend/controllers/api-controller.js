const authService = require('../services/auth-service');
const apiService = require('../services/api-service');
const passwordResetService = require('../services/password-reset-service');
const db = require('../data/database');
const { AppError } = require('../errors');

const statusCodes = {
  createUser: 201,
  createCarro: 201,
  createNotebooks: 201,
  createReservation: 201,
  createTicket: 201,
  requestReturn: 202
};

async function readBody(request) {
  if (!['POST', 'PATCH'].includes(request.method)) return {};
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new AppError('El cuerpo de la solicitud supera el límite permitido', 413);
  }
  if (!body) return {};
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new AppError('El cuerpo debe ser un objeto JSON válido', 400);
  }
}

function send(response, status, payload, corsHeaders) {
  const serialized = payload === null ? '' : JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(serialized),
    ...corsHeaders
  });
  response.end(serialized);
}

async function handle(request, response, route, corsHeaders) {
  try {
    const body = await readBody(request);
    let result;
    if (route.action === 'health') {
      await db.query('SELECT 1');
      result = { ok: true, service: 'netmo-api' };
    } else if (route.action === 'login') {
      result = await authService.login(body, request);
    } else if (route.action === 'forgotPassword') {
      result = await passwordResetService.requestForgot(body, request);
    } else if (route.action === 'resetPassword') {
      result = await passwordResetService.resetPassword(body, request);
    } else {
      const user = await authService.authenticate(request);
      if (request.url.startsWith('/api/admin/') && user.rol !== 'admin') {
        throw new AppError('Solo admin puede acceder a esta operación', 403);
      }
      if (route.action === 'requestPasswordChange') {
        result = await passwordResetService.requestChange(body, user, request);
      } else if (route.action === 'changePassword') {
        result = await passwordResetService.changePassword(body, user, request);
      } else {
        result = await apiService[route.action](
          body,
          user,
          route.params,
          new URL(request.url, 'http://api.invalid').searchParams
        );
      }
    }
    send(response, statusCodes[route.action] || 200, result, corsHeaders);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error(error);
    send(response, error.status || 500, { error: error.status ? error.message : 'Error interno del servidor' }, corsHeaders);
  }
}

module.exports = { handle, send };
