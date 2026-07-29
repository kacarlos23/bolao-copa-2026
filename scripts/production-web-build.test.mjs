import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function availablePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The child process can take a moment to bind the port on Windows.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`server did not become ready: ${url}`);
}

test('the production web build always publishes the approved competition experience', async () => {
  const packageJson = JSON.parse(await readFile('apps/web/package.json', 'utf8'));
  const buildScript = await readFile('apps/web/scripts/build-production.mjs', 'utf8');
  const startupScript = await readFile('scripts/check-start-project.ps1', 'utf8');
  const ecosystem = await readFile('ecosystem.config.cjs', 'utf8');

  assert.equal(packageJson.scripts.build, 'node scripts/build-production.mjs');
  assert.match(buildScript, /EXPO_PUBLIC_APP_IA_V2:\s*'1'/);
  assert.match(buildScript, /EXPO_PUBLIC_BRASILEIRAO_UI:\s*'1'/);
  assert.match(buildScript, /EXPO_PUBLIC_COMPETITION_UI_V2:\s*'1'/);
  assert.match(buildScript, /expoCli,\s*'export',\s*'--platform',\s*'web',\s*'--clear'/);
  assert.match(startupScript, /node dist\/src\/server\.js/);
  assert.doesNotMatch(startupScript, /set WEB_ORIGIN=http:\/\/localhost:\$Port/);
  assert.match(ecosystem, /script:\s*'scripts\/serve-dist\.mjs'/);
  assert.match(ecosystem, /API_ORIGIN:\s*'http:\/\/127\.0\.0\.1:3001'/);
  assert.doesNotMatch(ecosystem, /expo start/);
});

test('the production web server proxies public API paths to the internal API', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'bolao-production-web-'));
  const dist = join(tempRoot, 'dist');
  await mkdir(dist);
  await writeFile(join(dist, 'index.html'), '<h1>frontend</h1>');

  const requests = [];
  const apiServer = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'x-proxied-by-test-api': 'true',
    });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  const apiPort = await listen(apiServer);
  const webPort = await availablePort();
  const webServer = spawn(process.execPath, [resolve('apps/web/scripts/serve-dist.mjs')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      HOST: '127.0.0.1',
      PORT: String(webPort),
    },
    stdio: 'ignore',
  });

  t.after(async () => {
    webServer.kill();
    if (webServer.exitCode === null) await once(webServer, 'exit');
    apiServer.closeAllConnections?.();
    await new Promise((resolveClose) => apiServer.close(resolveClose));
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const rootResponse = await waitForServer(`http://127.0.0.1:${webPort}/`);
  assert.equal(await rootResponse.text(), '<h1>frontend</h1>');

  for (const path of [
    '/health',
    '/api/auth/csrf',
    '/api/events?seasonId=test',
    '/uploads/avatars/test.png',
  ]) {
    const response = await fetch(`http://127.0.0.1:${webPort}${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-proxied-by-test-api'), 'true');
    assert.deepEqual(await response.json(), { ok: true, path });
  }

  assert.deepEqual(requests, [
    '/health',
    '/api/auth/csrf',
    '/api/events?seasonId=test',
    '/uploads/avatars/test.png',
  ]);
});
