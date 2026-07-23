import { describe, expect, it, vi } from 'vitest';
import { createShutdownController } from './shutdown.js';

describe('runtime shutdown', () => {
  it('is idempotent and waits for HTTP, session pool and Prisma', async () => {
    const close = vi.fn((callback?: (error?: Error) => void) => callback?.());
    const stopJobs = vi.fn();
    const closeSse = vi.fn();
    const closeSessionStore = vi.fn(async () => undefined);
    const disconnectPrisma = vi.fn(async () => undefined);
    const shutdown = createShutdownController({
      server: { close },
      stopJobs,
      closeSse,
      closeSessionStore,
      disconnectPrisma,
    });

    const first = shutdown();
    const second = shutdown();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(stopJobs).toHaveBeenCalledOnce();
    expect(closeSse).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(closeSessionStore).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
  });

  it('forces open HTTP connections closed after the deadline and still closes owned resources', async () => {
    vi.useFakeTimers();
    const closeAllConnections = vi.fn();
    const closeSessionStore = vi.fn(async () => undefined);
    const disconnectPrisma = vi.fn(async () => undefined);
    const shutdown = createShutdownController({
      server: { close: vi.fn(), closeAllConnections },
      stopJobs: vi.fn(),
      closeSse: vi.fn(),
      closeSessionStore,
      disconnectPrisma,
      timeoutMs: 50,
    });

    const result = shutdown();
    const rejection = expect(result).rejects.toThrow('did not close within 50ms');
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(closeAllConnections).toHaveBeenCalledOnce();
    expect(closeSessionStore).toHaveBeenCalledOnce();
    expect(disconnectPrisma).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('waits for in-flight jobs before disconnecting Prisma', async () => {
    let releaseJobs!: () => void;
    const stopJobs = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseJobs = resolve;
        }),
    );
    const disconnectPrisma = vi.fn(async () => undefined);
    const shutdown = createShutdownController({
      server: { close: (callback) => callback?.() },
      stopJobs,
      closeSse: vi.fn(),
      closeSessionStore: vi.fn(async () => undefined),
      disconnectPrisma,
    });

    const result = shutdown();
    await Promise.resolve();
    expect(disconnectPrisma).not.toHaveBeenCalled();
    releaseJobs();
    await result;
    expect(disconnectPrisma).toHaveBeenCalledOnce();
  });
});
