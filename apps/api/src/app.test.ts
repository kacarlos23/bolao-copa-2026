import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from './config.js';

describe('app', () => {
  it('returns health status', async () => {
    const response = await request(createApp()).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('serves legacy avatars with a cross-origin resource policy', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bolao-avatar-'));
    const legacyAvatarDir = path.join(temporaryRoot, 'apps', 'api', 'uploads', 'avatars');
    const filename = 'legacy-avatar.webp';
    await fs.mkdir(legacyAvatarDir, { recursive: true });
    await fs.writeFile(path.join(legacyAvatarDir, filename), 'legacy-avatar');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(temporaryRoot);

    try {
      const response = await request(createApp()).get(`/uploads/avatars/${filename}`);

      expect(response.status).toBe(200);
      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    } finally {
      cwd.mockRestore();
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('returns JSON for unknown API routes instead of the web application HTML', async () => {
    const response = await request(createApp()).get('/api/unknown-route');

    expect(response.status).toBe(404);
    expect(response.type).toBe('application/json');
    expect(response.body.error).toMatchObject({
      status: 404,
      code: 'API_ROUTE_NOT_FOUND',
      message: 'Rota de API não encontrada.',
      requestId: response.headers['x-request-id'],
    });
  });

  it('allows only the generated hydration script and Cloudflare Insights in CSP', async () => {
    const response = await request(createApp()).get('/health');
    const policy = response.headers['content-security-policy'];

    expect(policy).toContain(
      "script-src 'self' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8=' https://static.cloudflareinsights.com",
    );
    expect(policy).toContain("connect-src 'self' https://cloudflareinsights.com");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('protects the internal realtime relay', async () => {
    const response = await request(createApp()).post('/api/internal/realtime/sync-completed').send({
      ranking: [],
      updatedMatchIds: [],
      updatedKnockoutFixtureIds: [],
      updatedAt: new Date().toISOString(),
    });

    expect(response.status).toBe(401);
  });

  it('accepts a realtime update with the internal secret', async () => {
    const response = await request(createApp())
      .post('/api/internal/realtime/sync-completed')
      .set('x-internal-events-secret', config.INTERNAL_EVENTS_SECRET ?? config.SESSION_SECRET)
      .send({
        ranking: [],
        updatedMatchIds: ['match-1'],
        updatedKnockoutFixtureIds: [],
        updatedAt: new Date().toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('rejects a state-changing cookie request without a valid CSRF token', async () => {
    const agent = request.agent(createApp());
    await agent.get('/api/auth/csrf');

    const response = await agent.post('/api/auth/logout').set('x-csrf-token', 'invalid');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INVALID_CSRF_TOKEN');
  });

  it('accepts a valid CSRF token from web and native clients before authorization', async () => {
    const agent = request.agent(createApp());
    const csrf = await agent.get('/api/auth/csrf');

    const webResponse = await agent
      .post('/api/auth/logout')
      .set('origin', config.WEB_ORIGIN)
      .set('x-csrf-token', csrf.body.csrfToken);
    const nativeResponse = await agent
      .post('/api/auth/logout')
      .set('x-csrf-token', csrf.body.csrfToken);

    expect(webResponse.status).toBe(401);
    expect(nativeResponse.status).toBe(401);
  });

  it('sets session cookies on HTTP local access and marks HTTPS proxy cookies secure', async () => {
    const httpResponse = await request(createApp()).get('/api/auth/csrf');
    const httpsResponse = await request(createApp())
      .get('/api/auth/csrf')
      .set('x-forwarded-proto', 'https');
    const cookieHeader = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value.join(';') : (value ?? '');

    expect(cookieHeader(httpResponse.headers['set-cookie'])).not.toContain('Secure');
    expect(cookieHeader(httpsResponse.headers['set-cookie'])).toContain('Secure');
  });

  it('accepts a same-origin mobile LAN request with a valid CSRF token', async () => {
    const agent = request.agent(createApp());
    const csrf = await agent.get('/api/auth/csrf');

    const response = await agent
      .post('/api/auth/logout')
      .set('host', '192.168.18.245:8080')
      .set('origin', 'http://192.168.18.245:8080')
      .set('x-csrf-token', csrf.body.csrfToken);

    expect(response.status).toBe(401);
  });

  it('rejects a cross-site request even when it presents a valid token', async () => {
    const agent = request.agent(createApp());
    const csrf = await agent.get('/api/auth/csrf');

    const response = await agent
      .post('/api/auth/logout')
      .set('origin', 'https://attacker.example')
      .set('sec-fetch-site', 'cross-site')
      .set('x-csrf-token', csrf.body.csrfToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INVALID_REQUEST_ORIGIN');
  });
});
