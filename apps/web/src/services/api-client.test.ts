import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, LatestRequest, errorMessage, request } from './api-client';

afterEach(() => vi.unstubAllGlobals());

describe('cliente HTTP', () => {
  it('valida a resposta na entrada e rejeita contrato incompatível', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: 'x' }), { status: 200 })));
    await expect(request('/contract', { schema: z.object({ value: z.number() }) })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
  });

  it.each([
    [401, 'Sua sessão expirou'],
    [403, 'Você não tem permissão'],
    [409, 'Palpite fechado'],
    [500, 'Falha interna'],
  ])('traduz erro %s sem perder status/código', (status, expected) => {
    const error = new ApiError(status === 409 ? 'Palpite fechado' : 'Falha interna', status, `HTTP_${status}`);
    expect(errorMessage(error)).toContain(expected);
  });

  it('cancela a chamada anterior e ignora resposta obsoleta', async () => {
    const latest = new LatestRequest();
    let resolveFirst!: (value: string) => void;
    const first = latest.run(() => new Promise<string>((resolve) => { resolveFirst = resolve; }));
    const second = latest.run(async () => 'nova');
    resolveFirst('antiga');

    await expect(second).resolves.toBe('nova');
    await expect(first).resolves.toBeUndefined();
  });
});
