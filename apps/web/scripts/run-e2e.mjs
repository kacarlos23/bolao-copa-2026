import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve('@playwright/test/cli');
const port = Number(process.env.PORT ?? 4173);
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  EXPO_PUBLIC_APP_IA_V2: '1',
  EXPO_PUBLIC_BRASILEIRAO_UI: '1',
  EXPO_PUBLIC_COMPETITION_UI_V2: '1',
  EXPO_PUBLIC_LEGACY_ADMIN_MUTATIONS: '1',
  PLAYWRIGHT_EXTERNAL_SERVER: '1',
  PORT: String(port),
};

const server = spawn(process.execPath, ['scripts/serve-e2e.mjs'], {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

let serverExited = false;
let isShuttingDown = false;
const serverExit = new Promise((resolve) => {
  server.once('exit', (code, signal) => {
    serverExited = true;
    if (!isShuttingDown) {
      process.stderr.write(`Servidor e2e encerrou antes dos testes: code=${code} signal=${signal}\n`);
    }
    resolve();
  });
});

server.once('error', (error) => {
  serverExited = true;
  process.stderr.write(`Falha ao iniciar servidor e2e: ${error.message}\n`);
});

try {
  await waitForServer();
  const result = spawnSync(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally {
  await stopServer();
}

async function waitForServer() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error('Servidor e2e encerrou antes de ficar disponivel.');
    if (await canReachServer()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Servidor e2e indisponivel em ${baseUrl}.`);
}

function canReachServer() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    const request = http.get(baseUrl, (response) => {
      response.resume();
      finish((response.statusCode ?? 500) < 500);
    });
    request.setTimeout(1_000, () => {
      request.destroy();
      finish(false);
    });
    request.on('error', () => finish(false));
  });
}

async function stopServer() {
  isShuttingDown = true;
  if (serverExited || !server.pid) return;
  server.kill('SIGTERM');
  await Promise.race([serverExit, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  if (!serverExited) server.kill('SIGKILL');
}
