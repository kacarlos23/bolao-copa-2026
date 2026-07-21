import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seasonFindUnique: vi.fn(),
  runFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  transaction: vi.fn(),
  runProviderSync: vi.fn(),
  refreshWindows: vi.fn(),
  enqueue: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: {
    competitionSeason: { findUnique: mocks.seasonFindUnique },
    providerSyncRun: { findUnique: mocks.runFindUnique, findFirst: mocks.runFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./provider-sync.service.js', () => ({ runProviderSync: mocks.runProviderSync }));
vi.mock('../brasileirao/brasileirao-2026.service.js', () => ({
  BRASILEIRAO_2026_SEASON_SLUG: 'brasileirao-serie-a-2026',
  refreshBrasileirao2026RoundWindows: mocks.refreshWindows,
}));
vi.mock('../events/outbox.js', () => ({
  enqueueOutboxEvent: mocks.enqueue,
  dispatchOutboxEvent: mocks.dispatch,
}));

import { syncOfficialSeasonResults } from './season-result-sync.service.js';

function summary(type: 'RESULTS' | 'STANDINGS', updated: number) {
  return {
    runId: `run-${type}`,
    provider: 'cbf-official',
    seasonId: 'season-1',
    type,
    dryRun: false,
    status: 'SUCCESS',
    source: 'fixture://cbf',
    checksum: 'checksum',
    startedAt: '2026-07-16T12:00:00.000Z',
    finishedAt: '2026-07-16T12:00:01.000Z',
    counts: { fetched: 10, inserted: 0, updated, unchanged: 10 - updated, quarantined: 0 },
    diff: updated ? [{ action: 'UPDATE', entity: 'RESULT', externalId: 'match:1', internalId: 'match-1' }] : [],
  };
}

describe('syncOfficialSeasonResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.seasonFindUnique.mockResolvedValue({ slug: 'brasileirao-serie-a-2026' });
    mocks.runFindUnique.mockResolvedValue(null);
    mocks.runFindFirst.mockResolvedValue(null);
    mocks.runProviderSync
      .mockResolvedValueOnce(summary('RESULTS', 1))
      .mockResolvedValueOnce(summary('STANDINGS', 2));
    mocks.refreshWindows.mockResolvedValue(undefined);
    mocks.enqueue.mockResolvedValueOnce({ id: 'event-match' }).mockResolvedValueOnce({ id: 'event-sync' });
    mocks.transaction.mockImplementation((callback: (tx: object) => unknown) => callback({}));
  });

  it('sincroniza resultados antes da classificação e publica SSE resumido', async () => {
    const result = await syncOfficialSeasonResults({ seasonId: 'season-1', userId: 'user-1', idempotencyKey: 'request-123' });

    expect(mocks.runProviderSync.mock.calls.map((call) => call[1].type)).toEqual(['RESULTS', 'STANDINGS']);
    expect(mocks.runProviderSync.mock.calls[0]?.[1].idempotencyKey).toBe('request-123:results');
    expect(result).toMatchObject({ status: 'UPDATED', changedMatches: 1 });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'provider.sync.completed' }));
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  it('rejeita temporada sem provider público configurado', async () => {
    mocks.seasonFindUnique.mockResolvedValue({ slug: 'world-cup-2026' });
    await expect(syncOfficialSeasonResults({ seasonId: 'cup', userId: 'user-1', idempotencyKey: 'request-123' })).rejects.toMatchObject({ code: 'SEASON_PROVIDER_NOT_CONFIGURED' });
    expect(mocks.runProviderSync).not.toHaveBeenCalled();
  });
});
