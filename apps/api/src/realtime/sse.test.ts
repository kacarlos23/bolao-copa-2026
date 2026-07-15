import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeSseClientCount, addSseClient, closeAllSseClients, emitSse } from './sse.js';

describe('SSE delivery', () => {
  afterEach(() => {
    closeAllSseClients();
    vi.useRealTimers();
  });

  it('flushes events immediately after writing them', () => {
    const handlers = new Map<string, () => void>();
    const response = {
      write: vi.fn(() => true),
      flush: vi.fn(),
      once: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      end: vi.fn(),
      writableEnded: false,
      destroyed: false,
    } as unknown as Response;

    addSseClient(response);
    vi.mocked(response.write).mockClear();
    vi.mocked((response as Response & { flush: () => void }).flush).mockClear();

    emitSse('ranking.updated', { ranking: [] });

    expect(response.write).toHaveBeenCalledWith('event: ranking.updated\ndata: {"ranking":[]}\n\n');
    expect((response as Response & { flush: () => void }).flush).toHaveBeenCalledOnce();
    handlers.get('close')?.();
    expect(activeSseClientCount()).toBe(0);
  });

  it('uses one fake-timer heartbeat and drains every client during shutdown', () => {
    vi.useFakeTimers();
    const response = {
      write: vi.fn(() => true),
      flush: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      end: vi.fn(function (this: { writableEnded: boolean }) {
        this.writableEnded = true;
      }),
      writableEnded: false,
      destroyed: false,
    } as unknown as Response;

    addSseClient(response);
    vi.mocked(response.write).mockClear();
    vi.advanceTimersByTime(25_000);

    expect(response.write).toHaveBeenCalledWith(': heartbeat\n\n');
    closeAllSseClients();
    expect(response.end).toHaveBeenCalledOnce();
    expect(activeSseClientCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
