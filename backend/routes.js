const routes = [
  ['GET', /^\/health$/, 'health'],
  ['POST', /^\/api\/auth\/login$/, 'login'],
  ['POST', /^\/api\/auth\/forgot$/, 'forgotPassword'],
  ['POST', /^\/api\/auth\/reset$/, 'resetPassword'],
  ['POST', /^\/api\/auth\/change-password\/request$/, 'requestPasswordChange'],
  ['POST', /^\/api\/auth\/change-password$/, 'changePassword'],
  ['GET', /^\/api\/me$/, 'me'],
  ['GET', /^\/api\/admin\/professors$/, 'professors'],
  ['GET', /^\/api\/admin\/users$/, 'users'],
  ['POST', /^\/api\/admin\/users$/, 'createUser'],
  ['GET', /^\/api\/carros$/, 'availableCarros'],
  ['GET', /^\/api\/admin\/carros$/, 'carros'],
  ['POST', /^\/api\/admin\/carros$/, 'createCarro'],
  ['POST', /^\/api\/admin\/notebooks$/, 'createNotebooks'],
  ['GET', /^\/api\/preferences$/, 'preferences'],
  ['PATCH', /^\/api\/preferences$/, 'updatePreferences'],
  ['GET', /^\/api\/notebooks$/, 'notebooks'],
  ['PATCH', /^\/api\/notebooks\/([^/]+)$/, 'updateNotebook', ['code']],
  ['GET', /^\/api\/reservations$/, 'reservations'],
  ['POST', /^\/api\/reservations$/, 'createReservation'],
  ['DELETE', /^\/api\/reservations\/([^/]+)$/, 'cancelReservation', ['code']],
  ['GET', /^\/api\/admin\/reservations$/, 'adminReservations'],
  ['POST', /^\/api\/admin\/reservations\/(\d+)\/approve$/, 'approveReservation', ['id']],
  ['POST', /^\/api\/admin\/reservations\/(\d+)\/reject$/, 'rejectReservation', ['id']],
  ['POST', /^\/api\/admin\/reservations\/(\d+)\/checkout$/, 'checkoutReservation', ['id']],
  ['GET', /^\/api\/loans$/, 'loans'],
  ['POST', /^\/api\/loans\/(\d+)\/return$/, 'requestReturn', ['id']],
  ['GET', /^\/api\/admin\/returns$/, 'adminReturns'],
  ['GET', /^\/api\/admin\/open-loans$/, 'adminOpenLoans'],
  ['POST', /^\/api\/admin\/returns\/(\d+)\/confirm$/, 'confirmReturn', ['id']],
  ['GET', /^\/api\/tickets$/, 'tickets'],
  ['GET', /^\/api\/admin\/tickets$/, 'adminTickets'],
  ['POST', /^\/api\/tickets$/, 'createTicket'],
  ['PATCH', /^\/api\/tickets\/([^/]+)$/, 'updateTicket', ['code']],
  ['GET', /^\/api\/admin\/late-returns$/, 'lateReturns'],
  ['GET', /^\/api\/admin\/backup$/, 'downloadAdminBackup'],
  ['POST', /^\/api\/admin\/restore$/, 'restoreAdminBackup'],
  ['PATCH', /^\/api\/admin\/users\/([^/]+)$/, 'updateUser', ['legajo']],
  ['PATCH', /^\/api\/admin\/users\/([^/]+)\/rol$/, 'updateUserRole', ['legajo']]
];

function resolve(method, pathname) {
  for (const [routeMethod, pattern, action, names = []] of routes) {
    if (routeMethod !== method) continue;
    const match = pathname.match(pattern);
    if (!match) continue;
    const params = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
    if (params.id !== undefined) params.id = Number(params.id);
    return { action, params };
  }
  return null;
}

module.exports = { resolve };
