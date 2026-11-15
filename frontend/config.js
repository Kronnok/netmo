const netmoLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

window.NETMO_CONFIG = {
  apiBaseUrl: netmoLocalHost ? 'http://localhost:3000' : 'https://netmo-api.onrender.com'
};
