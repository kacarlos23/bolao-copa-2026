import type { Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeSseClientCount, addSseClient, closeAllSseClients, closeSseClientsForUser, emitSse, sseHealthSnapshot } from './sse.js';

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

    const envelope = emitSse('ranking.updated', { ranking: [] });

    expect(response.write).toHaveBeenCalledWith(
      `event: ranking.updated\nid: ${envelope.eventId}\ndata: ${JSON.stringify(envelope)}\n\n`,
    );
    expect(envelope).toMatchObject({
      type: 'ranking.updated',
      seasonId: 'competition-season-world-cup-2026',
      poolSeasonId: 'pool-season-bolao-do-trabalho-world-cup-2026',
      version: 1,
      payload: { ranking: [] },
    });
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

  it('filters delivery by season and pool context', () => {
    const response = {
      write: vi.fn(() => true),
      flush: vi.fn(),
      once: vi.fn(),
      off: vi.fn(),
      end: vi.fn(),
      writableEnded: false,
      destroyed: false,
    } as unknown as Response;

    addSseClient(response, undefined, { seasonId: 'season-1', poolSeasonId: 'pool-season-1' });
    vi.mocked(response.write).mockClear();

    emitSse('prediction.updated', { matchIds: ['match-2'] }, {
      seasonId: 'season-2',
      poolSeasonId: 'pool-season-2',
    });
    expect(response.write).not.toHaveBeenCalled();

    const expected = emitSse('prediction.updated', { matchIds: ['match-1'] }, {
      seasonId: 'season-1',
      poolSeasonId: 'pool-season-1',
    });
    expect(response.write).toHaveBeenCalledWith(
      `event: prediction.updated\nid: ${expected.eventId}\ndata: ${JSON.stringify(expected)}\n\n`,
    );
  });

  it('applies backpressure until drain instead of buffering without limit', () => {
    const handlers = new Map<string, () => void>();
    const response = {
      write: vi.fn(() => false), flush: vi.fn(),
      once: vi.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
      off: vi.fn(), end: vi.fn(), writableEnded: false, destroyed: false,
    } as unknown as Response;
    addSseClient(response);
    expect(sseHealthSnapshot().blockedClients).toBe(1);
    const writes = vi.mocked(response.write).mock.calls.length;
    emitSse('ranking.updated', { fixture: true });
    expect(response.write).toHaveBeenCalledTimes(writes);
    vi.mocked(response.write).mockReturnValue(true);
    handlers.get('drain')?.();
    emitSse('ranking.updated', { fixture: true });
    expect(response.write).toHaveBeenCalledTimes(writes + 1);
  });

  it('closes every connection of a blocked or logged-out user', () => {
    const response = {
      write: vi.fn(() => true), flush: vi.fn(), once: vi.fn(), off: vi.fn(), end: vi.fn(), writableEnded: false, destroyed: false,
    } as unknown as Response;
    const request = {
      session: { user: { id: 'blocked-user' } },
      once: vi.fn(), off: vi.fn(),
    } as never;
    addSseClient(response, request);
    closeSseClientsForUser('blocked-user');
    expect(response.end).toHaveBeenCalledOnce();
    expect(activeSseClientCount()).toBe(0);
  });
});
