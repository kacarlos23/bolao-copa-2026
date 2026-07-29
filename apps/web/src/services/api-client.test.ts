import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('api client session csrf lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests a fresh csrf token after login rotates the session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'a'.repeat(40) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'admin' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ csrfToken: 'b'.repeat(40) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { request } = await import('./api-client');
    await request('/api/auth/login', { method: 'POST', body: '{}' });
    await request('/api/auth/logout', { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/csrf');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/auth/csrf');
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'x-csrf-token': 'a'.repeat(40),
    });
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toMatchObject({
      'x-csrf-token': 'b'.repeat(40),
    });
  });

  it('reports an invalid API response without exposing the JSON parser error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!DOCTYPE html><html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    const { request } = await import('./api-client');

    await expect(request('/api/unknown-route')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('preserves explicit 403 messages for authorization and CSRF diagnostics', async () => {
    const { ApiError, errorMessage } = await import('./api-client');

    expect(
      errorMessage(
        new ApiError('Origem da requisição não permitida.', 403, 'INVALID_REQUEST_ORIGIN'),
      ),
    ).toBe('Origem da requisição não permitida.');
  });
});

describe('api client browser URL', () => {
  it('keeps public HTTPS requests on the current origin', async () => {
    const { apiUrlForBrowserLocation } = await import('./api-client');

    expect(
      apiUrlForBrowserLocation({
        hostname: 'bolao.sirel.com.br',
        origin: 'https://bolao.sirel.com.br',
        protocol: 'https:',
      }, 'production'),
    ).toBe('https://bolao.sirel.com.br');
  });

  it('uses the API development port for local HTTP requests', async () => {
    const { apiUrlForBrowserLocation } = await import('./api-client');

    expect(
      apiUrlForBrowserLocation({
        hostname: '192.168.18.245',
        origin: 'http://192.168.18.245:8080',
        protocol: 'http:',
      }, 'development'),
    ).toBe('http://192.168.18.245:3001');
  });
});
