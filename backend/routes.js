const routes = [
  ['GET', /^\/health$/, 'health'],
  ['POST', /^\/api\/auth\/login$/, 'login'],
  ['POST', /^\/api\/auth\/refresh$/, 'refresh'],
  ['POST', /^\/api\/auth\/forgot$/, 'forgotPassword'],
  ['POST', /^\/api\/auth\/reset$/, 'resetPassword'],
  ['POST', /^\/api\/auth\/change-password\/request$/, 'requestPasswordChange'],
  ['POST', /^\/api\/auth\/change-password$/, 'changePassword'],
  ['GET', /^\/api\/me$/, 'me'],
  ['GET', /^\/api\/admin\/professors$/, 'professors'],
  ['GET', /^\/api\/admin\/users$/, 'users'],
  ['POST', /^\/api\/admin\/users$/, 'createUser'],
  ['GET', /^\/api\/carros$/, 'availableCarros'],
  ['GET', /^\/api\/admin\/ubicaciones$/, 'ubicaciones'],
  ['POST', /^\/api\/admin\/ubicaciones$/, 'createUbicacion'],
  ['PATCH', /^\/api\/admin\/ubicaciones\/([^/]+)$/, 'updateUbicacion', ['slug']],
  ['DELETE', /^\/api\/admin\/ubicaciones\/([^/]+)$/, 'deleteUbicacion', ['slug']],
  ['GET', /^\/api\/admin\/carros$/, 'carros'],
  ['POST', /^\/api\/admin\/carros$/, 'createCarro'],
  ['PATCH', /^\/api\/admin\/carros\/(\d{1,3})$/, 'updateCarro', ['numero']],
  ['DELETE', /^\/api\/admin\/carros\/(\d{1,3})$/, 'deleteCarro', ['numero']],
  ['POST', /^\/api\/admin\/notebooks$/, 'createNotebooks'],
  ['GET', /^\/api\/preferences$/, 'preferences'],
  ['PATCH', /^\/api\/preferences$/, 'updatePreferences'],
  ['GET', /^\/api\/notebooks$/, 'notebooks'],
  ['PATCH', /^\/api\/notebooks\/([^/]+)$/, 'updateNotebook', ['code']],
  ['GET', /^\/api\/reservations$/, 'reservations'],
  ['POST', /^\/api\/reservations$/, 'createReservation'],
  ['DELETE', /^\/api\/reservations\/([^/]+)$/, 'cancelReservation', ['code']],
  ['GET', /^\/api\/admin\/reservations$/, 'adminReservations'],
  ['POST', /^\/api\/admin\/reservations\/(\d+)\/approve-checkout$/, 'approveAndCheckoutReservation', ['id']],
  ['POST', /^\/api\/admin\/reservations\/(\d+)\/approve$/, 'approveReservation', ['id']],
  ['POST', /^\/api\/admin\/reservations\/(\d+)\/reject$/, 'rejectReservation', ['id']],
  ['POST', /^\/api\/admin\/reservations\/(\d+)\/checkout$/, 'checkoutReservation', ['id']],
  ['GET', /^\/api\/loans$/, 'loans'],
  ['POST', /^\/api\/loans\/(\d+)\/return$/, 'requestReturn', ['id']],
  ['GET', /^\/api\/admin\/returns$/, 'adminReturns'],
  ['GET', /^\/api\/admin\/open-loans$/, 'adminOpenLoans'],
  ['GET', /^\/api\/admin\/loans$/, 'adminLoans'],
  ['POST', /^\/api\/admin\/loans\/return$/, 'adminReturnLoans'],
  ['POST', /^\/api\/admin\/loans\/(\d+)\/return$/, 'adminReturnLoan', ['id']],
  ['POST', /^\/api\/admin\/returns\/(\d+)\/confirm$/, 'confirmReturn', ['id']],
  ['GET', /^\/api\/tickets$/, 'tickets'],
  ['GET', /^\/api\/tickets\/notebooks$/, 'ticketNotebooks'],
  ['GET', /^\/api\/tickets\/([^/]+)\/replies$/, 'ticketReplies', ['code']],
  ['POST', /^\/api\/tickets\/([^/]+)\/replies$/, 'createTicketReply', ['code']],
  ['GET', /^\/api\/admin\/tickets$/, 'adminTickets'],
  ['POST', /^\/api\/tickets$/, 'createTicket'],
  ['POST', /^\/api\/internal\/reminders$/, 'sendReturnReminders'],
  ['PATCH', /^\/api\/tickets\/([^/]+)$/, 'updateTicket', ['code']],
  ['GET', /^\/api\/admin\/late-returns$/, 'lateReturns'],
  ['GET', /^\/api\/admin\/backup$/, 'downloadAdminBackup'],
  ['POST', /^\/api\/admin\/restore$/, 'restoreAdminBackup'],
  ['PATCH', /^\/api\/admin\/users\/([^/]+)$/, 'updateUser', ['dni']],
  ['PATCH', /^\/api\/admin\/users\/([^/]+)\/rol$/, 'updateUserRole', ['dni']]
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
