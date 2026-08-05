import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// The production server deliberately remains dependency-free Node ESM.
// @ts-expect-error No TypeScript declaration is emitted for the runtime .mjs entrypoint.
import { createDistributionServer } from '../scripts/serve-dist.mjs';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function startServer(options: Parameters<typeof createDistributionServer>[0] = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bolao-web-dist-'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Bolao</title>');
  const server = createDistributionServer({ root, releaseSha: 'abc1234', ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    () => fs.rm(root, { recursive: true, force: true }),
  );
  return `http://127.0.0.1:${port}`;
}

describe('production web server', () => {
  it('publishes a no-cache health marker for the active release', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      releaseSha: 'abc1234',
    });
  });

  it('does not simulate API or SSE traffic', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/events`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('content-type')).not.toContain('text/event-stream');
  });

  it('forwards API traffic to the configured internal API origin', async () => {
    const upstream = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ path: request.url, forwardedHost: request.headers['x-forwarded-host'] }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          upstream.closeAllConnections?.();
          upstream.close(() => resolve());
        }),
    );

    const baseUrl = await startServer({ apiOrigin: `http://127.0.0.1:${upstreamPort}` });
    const response = await fetch(`${baseUrl}/api/fundraising?season=2026`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ path: '/api/fundraising?season=2026' });
  });

  it('forwards POST login requests to the configured internal API origin', async () => {
    const upstream = createServer(async (request, response) => {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        request.on('error', reject);
      });

      response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ method: request.method, path: request.url, body }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          upstream.closeAllConnections?.();
          upstream.close(() => resolve());
        }),
    );

    const baseUrl = await startServer({ apiOrigin: `http://127.0.0.1:${upstreamPort}` });
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'proxy-test-user', password: 'proxy-test-password' }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      method: 'POST',
      path: '/api/auth/login',
      body: '{"nickname":"proxy-test-user","password":"proxy-test-password"}',
    });
  });
});
