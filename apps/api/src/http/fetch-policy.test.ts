import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTextWithPolicy, ResponseTooLargeError } from './fetch-policy.js';

const basePolicy = { timeoutMs: 1_000, maxBytes: 32, retries: 0 };

describe('bounded HTTP fetch', () => {
  afterEach(() => vi.useRealTimers());

  it('aborts a provider request at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    const result = fetchTextWithPolicy(
      'https://provider.example',
      {},
      {
        ...basePolicy,
        timeoutMs: 25,
        fetchImpl,
      },
    );
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  it('rejects a response whose declared or streamed body exceeds the byte limit', async () => {
    const declared = vi.fn(
      async () => new Response('small', { headers: { 'content-length': '1000' } }),
    ) as unknown as typeof fetch;
    const streamed = vi.fn(async () => new Response('x'.repeat(64))) as unknown as typeof fetch;

    await expect(
      fetchTextWithPolicy('https://provider.example', {}, { ...basePolicy, fetchImpl: declared }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    await expect(
      fetchTextWithPolicy('https://provider.example', {}, { ...basePolicy, fetchImpl: streamed }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('retries controlled transient failures and does not retry validation failures', async () => {
    const transient = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok')) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);

    await expect(
      fetchTextWithPolicy(
        'https://provider.example',
        {},
        {
          ...basePolicy,
          retries: 1,
          fetchImpl: transient,
          sleep,
          random: () => 0,
        },
      ),
    ).resolves.toBe('ok');
    expect(transient).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(200);

    const oversized = vi.fn(async () => new Response('x'.repeat(64))) as unknown as typeof fetch;
    await expect(
      fetchTextWithPolicy(
        'https://provider.example',
        {},
        {
          ...basePolicy,
          retries: 2,
          fetchImpl: oversized,
          sleep,
        },
      ),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(oversized).toHaveBeenCalledOnce();
  });
});
