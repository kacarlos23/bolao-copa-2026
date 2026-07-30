import { createReadStream, existsSync, statSync } from 'node:fs';
<<<<<<< HEAD
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

=======
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

>>>>>>> df72695 (Add deployment rollback and smoke test scripts)
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

<<<<<<< HEAD
function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

=======
<<<<<<< HEAD
>>>>>>> a6ada8c (Add deployment rollback and smoke test scripts)
function isApiRequest(url = '/') {
  const pathname = new URL(url, 'http://web.local').pathname;
  return (
    pathname === '/health' ||
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/uploads/avatars' ||
    pathname.startsWith('/uploads/avatars/')
  );
}

function normalizeApiOrigin(apiOrigin) {
  if (!apiOrigin) return null;
  const parsedOrigin = new URL(apiOrigin);
  if (
    parsedOrigin.protocol !== 'http:' ||
    parsedOrigin.username ||
    parsedOrigin.password ||
    parsedOrigin.pathname !== '/' ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error('API_ORIGIN must be a plain internal HTTP origin');
  }
  return parsedOrigin;
}

function proxyToApi(request, response, apiOrigin) {
  const headers = {
    ...request.headers,
    host: apiOrigin.host,
    'x-forwarded-host': request.headers['x-forwarded-host'] ?? request.headers.host ?? '',
    'x-forwarded-proto': request.headers['x-forwarded-proto'] ?? 'http',
  };
  const upstream = httpRequest(
    new URL(request.url ?? '/', apiOrigin),
    {
      method: request.method,
      headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    }
    response.end(JSON.stringify({ error: { code: 'API_UNAVAILABLE' } }));
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
}

export function createDistributionServer({
  root = join(process.cwd(), 'dist'),
  releaseSha = process.env.APP_RELEASE_SHA ?? 'development',
  testRequestHandler,
  apiOrigin = process.env.API_ORIGIN,
} = {}) {
  const distributionRoot = resolve(root);
  const distributionPrefix = distributionRoot.endsWith(sep)
    ? distributionRoot
    : `${distributionRoot}${sep}`;
  const resolvedApiOrigin = normalizeApiOrigin(apiOrigin);

  return createServer((request, response) => {
    // E2E may inject deterministic API doubles without shipping them in the
    // production entrypoint. Returning true means the request was handled.
    if (testRequestHandler?.(request, response) === true) return;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      writeJson(response, 400, { status: 'invalid_request' });
      return;
    }

    if (resolvedApiOrigin && isApiRequest(request.url)) {
      proxyToApi(request, response, resolvedApiOrigin);
      return;
    }

    if (pathname === '/health') {
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        });
        response.end();
        return;
      }
      writeJson(response, 200, { status: 'ok', releaseSha });
      return;
    }

    // API traffic must be routed to the API process/reverse proxy. Returning
    // index.html here would hide a routing failure, and the old fake SSE endpoint
    // made production appear healthy while no realtime connection existed.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      writeJson(response, 404, { status: 'not_found' });
      return;
    }

    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    const candidate = resolve(distributionRoot, relative || 'index.html');
    const contained = candidate === distributionRoot || candidate.startsWith(distributionPrefix);
    let file = contained ? candidate : join(distributionRoot, 'index.html');

    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(distributionRoot, 'index.html');
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      writeJson(response, 503, { status: 'unavailable', releaseSha });
      return;
    }

    const contentType = types[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, {
      'cache-control': contentType.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
    });
<<<<<<< HEAD
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  });
}

=======
    response.write(': connected\n\n');
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 10_000);
    request.on('close', () => clearInterval(heartbeat));
    return;
  }

  const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const relative = normalize(requested).replace(/^([/\\])+/, '');
  let file = join(root, relative || 'index.html');
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, 'index.html');
  }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  process.stdout.write(`Frontend disponivel em http://${host}:${port}\n`);
});

function shutdown() {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
=======
function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
>>>>>>> df72695 (Add deployment rollback and smoke test scripts)
}

export function createDistributionServer({
  root = join(process.cwd(), 'dist'),
  releaseSha = process.env.APP_RELEASE_SHA ?? 'development',
  testRequestHandler,
} = {}) {
  const distributionRoot = resolve(root);
  const distributionPrefix = distributionRoot.endsWith(sep)
    ? distributionRoot
    : `${distributionRoot}${sep}`;

  return createServer((request, response) => {
    // E2E may inject deterministic API doubles without shipping them in the
    // production entrypoint. Returning true means the request was handled.
    if (testRequestHandler?.(request, response) === true) return;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      writeJson(response, 400, { status: 'invalid_request' });
      return;
    }

    if (pathname === '/health') {
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        });
        response.end();
        return;
      }
      writeJson(response, 200, { status: 'ok', releaseSha });
      return;
    }

    // API traffic must be routed to the API process/reverse proxy. Returning
    // index.html here would hide a routing failure, and the old fake SSE endpoint
    // made production appear healthy while no realtime connection existed.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      writeJson(response, 404, { status: 'not_found' });
      return;
    }

    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    const candidate = resolve(distributionRoot, relative || 'index.html');
    const contained = candidate === distributionRoot || candidate.startsWith(distributionPrefix);
    let file = contained ? candidate : join(distributionRoot, 'index.html');

    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(distributionRoot, 'index.html');
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      writeJson(response, 503, { status: 'unavailable', releaseSha });
      return;
    }

    const contentType = types[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, {
      'cache-control': contentType.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
      'content-type': contentType,
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  });
}

>>>>>>> a6ada8c (Add deployment rollback and smoke test scripts)
export function startDistributionServer({
  host = process.env.HOST ?? '127.0.0.1',
  port = Number(process.env.PORT ?? 4173),
  ...serverOptions
} = {}) {
  const server = createDistributionServer(serverOptions).listen(port, host, () => {
    const address = server.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    process.stdout.write(`Frontend disponivel em http://${host}:${activePort}\n`);
    process.send?.('ready');
  });

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.closeIdleConnections?.();
    const deadline = setTimeout(() => server.closeAllConnections?.(), 5_000);
    deadline.unref?.();
    server.close(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('message', (message) => {
    if (message === 'shutdown') shutdown();
  });
  return server;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  startDistributionServer();
}
