import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 4173);
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

const server = createServer((request, response) => {
  if (request.url?.startsWith('/api/events')) {
    response.writeHead(200, {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    });
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
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Frontend disponivel em http://127.0.0.1:${port}\n`);
});

function shutdown() {
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
