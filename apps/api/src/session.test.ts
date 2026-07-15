import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { destroySession, regenerateSession } from './session.js';

function requestWithCallbacks(callbacks: {
  regenerate: (callback: (error?: unknown) => void) => void;
  destroy: (callback: (error?: unknown) => void) => void;
}) {
  return { session: callbacks } as unknown as Request;
}

describe('session callback adapters', () => {
  it('rejects when session regeneration fails', async () => {
    const failure = new Error('regenerate failed');
    const req = requestWithCallbacks({
      regenerate: (callback) => callback(failure),
      destroy: vi.fn(),
    });

    await expect(regenerateSession(req)).rejects.toBe(failure);
  });

  it('rejects when session destruction fails', async () => {
    const failure = new Error('destroy failed');
    const req = requestWithCallbacks({
      regenerate: vi.fn(),
      destroy: (callback) => callback(failure),
    });

    await expect(destroySession(req)).rejects.toBe(failure);
  });
});
