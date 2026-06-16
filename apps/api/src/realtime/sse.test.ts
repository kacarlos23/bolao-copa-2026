import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { addSseClient, emitSse } from './sse.js';

describe('SSE delivery', () => {
  it('flushes events immediately after writing them', () => {
    const handlers = new Map<string, () => void>();
    const response = {
      write: vi.fn(),
      flush: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
    } as unknown as Response;

    addSseClient(response);
    vi.mocked(response.write).mockClear();
    vi.mocked((response as Response & { flush: () => void }).flush).mockClear();

    emitSse('ranking.updated', { ranking: [] });

    expect(response.write).toHaveBeenCalledWith(
      'event: ranking.updated\ndata: {"ranking":[]}\n\n',
    );
    expect((response as Response & { flush: () => void }).flush).toHaveBeenCalledOnce();
    handlers.get('close')?.();
  });
});
