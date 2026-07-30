import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const managedKeys = [
  'DOTENV_CONFIG_PATH',
  'DATABASE_URL',
  'SESSION_SECRET',
  'APP_RELEASE_SHA',
  'AVATAR_UPLOAD_DIR',
  'PRODUCTION_WEB_URL',
  'PRODUCTION_API_URL',
] as const;
const originalValues = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const key of managedKeys) {
    const original = originalValues[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  vi.resetModules();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe.sequential('runtime configuration', () => {
  it('loads the explicitly configured production env file before validation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bolao-production-env-'));
    temporaryRoots.push(root);
    const environmentPath = path.join(root, 'production.env');
    await fs.writeFile(
      environmentPath,
      [
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bolao',
        'SESSION_SECRET=external-session-secret-longer-than-24-characters',
        'APP_RELEASE_SHA=abc1234',
        `AVATAR_UPLOAD_DIR=${path.join(root, 'avatars').replaceAll('\\', '/')}`,
        'PRODUCTION_WEB_URL=https://bolao.example.com',
        'PRODUCTION_API_URL=https://api.bolao.example.com',
      ].join('\n'),
    );

    for (const key of managedKeys) delete process.env[key];
    process.env.DOTENV_CONFIG_PATH = environmentPath;
    vi.resetModules();

    const { config } = await import('./config.js');

    expect(config.DOTENV_CONFIG_PATH).toBe(environmentPath);
    expect(config.APP_RELEASE_SHA).toBe('abc1234');
    expect(config.AVATAR_UPLOAD_DIR).toBe(path.join(root, 'avatars').replaceAll('\\', '/'));
    expect(config.PRODUCTION_WEB_URL).toBe('https://bolao.example.com');
    expect(config.PRODUCTION_API_URL).toBe('https://api.bolao.example.com');
  });

  it('fails fast when an explicit env file is missing', async () => {
    const missingPath = path.join(os.tmpdir(), `missing-bolao-${Date.now()}.env`);
    process.env.DOTENV_CONFIG_PATH = missingPath;
    vi.resetModules();

    await expect(import('./config.js')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
