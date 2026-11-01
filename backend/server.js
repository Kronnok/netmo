const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const routes = require('./routes');
const controller = require('./controllers/api-controller');

const frontendDir = path.resolve(__dirname, '..', 'frontend');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
};

function corsHeaders(request) {
  const origin = request.headers.origin;
  const allowed = config.corsOrigins.includes('*') || config.corsOrigins.includes(origin);
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin'
  };
  if (origin && allowed) headers['Access-Control-Allow-Origin'] = config.corsOrigins.includes('*') ? '*' : origin;
  return headers;
}

function serveFrontend(response, pathname, headers) {
  let relativePath;
  try {
    relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  } catch {
    response.writeHead(400, headers).end();
    return;
  }
  const filePath = path.resolve(frontendDir, relativePath);
  if (!filePath.startsWith(`${frontendDir}${path.sep}`)) {
    response.writeHead(403, headers).end();
    return;
  }
  const contentType = contentTypes[path.extname(filePath)];
  if (!contentType) {
    response.writeHead(404, headers).end();
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, headers).end();
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Type': contentType });
    response.end(data);
  });
}

const server = http.createServer((request, response) => {
  const headers = corsHeaders(request);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers).end();
    return;
  }
  const url = new URL(request.url, 'http://api.invalid');
  let route;
  try {
    route = routes.resolve(request.method, url.pathname);
  } catch {
    response.writeHead(400, headers).end();
    return;
  }
  if (route) {
    controller.handle(request, response, route, headers);
    return;
  }
  if (config.serveFrontend && request.method === 'GET' && !url.pathname.startsWith('/api/')) {
    serveFrontend(response, url.pathname, headers);
    return;
  }
  controller.send(response, 404, { error: 'Ruta no encontrada' }, headers);
});

server.listen(config.port, '0.0.0.0', () => console.log(`NetMO API escuchando en ${config.port}`));

function shutdown() {
  server.close(() => {
    require('./data/database').pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
