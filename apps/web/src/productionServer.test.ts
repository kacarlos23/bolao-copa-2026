import fs from 'node:fs/promises';
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

async function startServer() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bolao-web-dist-'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Bolao</title>');
  const server = createDistributionServer({ root, releaseSha: 'abc1234' });
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
});
