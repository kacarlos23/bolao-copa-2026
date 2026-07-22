import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runFindUnique: vi.fn(),
  runFindFirst: vi.fn(),
  transaction: vi.fn(),
  runProviderSync: vi.fn(),
  registryCreate: vi.fn(),
  getRuntime: vi.fn(),
  listRuntime: vi.fn(),
  scoreSyncSetting: vi.fn(),
  enqueue: vi.fn(),
  dispatch: vi.fn(),
  afterSync: vi.fn(),
  competitionFlags: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: {
    providerSyncRun: { findUnique: mocks.runFindUnique, findFirst: mocks.runFindFirst },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./provider-sync.service.js', () => ({ runProviderSync: mocks.runProviderSync }));
vi.mock('./provider-registry.js', () => ({
  seasonProviderRegistry: { create: mocks.registryCreate },
}));
vi.mock('./season-runtime-config.js', () => ({
  getSeasonRuntimeConfig: mocks.getRuntime,
  listActiveSeasonRuntimeConfigs: mocks.listRuntime,
}));
vi.mock('../../services/score-sync-settings.service.js', () => ({
  getScoreSyncSetting: mocks.scoreSyncSetting,
}));
vi.mock('../events/outbox.js', () => ({
  enqueueOutboxEvent: mocks.enqueue,
  dispatchOutboxEvent: mocks.dispatch,
}));
vi.mock('../competitions/competition-feature.service.js', () => ({
  getCompetitionFeatureFlags: mocks.competitionFlags,
}));

import {
  runAutomaticSeasonSyncs,
  syncOfficialSeasonResults,
} from './season-result-sync.service.js';

const providerConfig = {
  key: 'fixture-hybrid-provider',
  priority: 1,
  types: ['RESULTS', 'STANDINGS'] as Array<'RESULTS' | 'STANDINGS'>,
  enabled: true,
  timeoutMs: 10_000,
  includeProfiles: false,
};

function summary(type: 'RESULTS' | 'STANDINGS', updated: number, seasonId = 'hybrid-season') {
  return {
    runId: `run-${seasonId}-${type}`,
    provider: providerConfig.key,
    seasonId,
    type,
    dryRun: false,
    status: 'SUCCESS',
    source: 'fixture://hybrid',
    checksum: 'checksum',
    startedAt: '2026-07-16T12:00:00.000Z',
    finishedAt: '2026-07-16T12:00:01.000Z',
    counts: { fetched: 10, inserted: 0, updated, unchanged: 10 - updated, quarantined: 0 },
    diff: updated
      ? [
          {
            action: 'UPDATE',
            entity: 'RESULT',
            externalId: 'match:1',
            internalId: 'match-1',
          },
        ]
      : [],
  };
}

describe('sincronização configurada por temporada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntime.mockResolvedValue({
      seasonId: 'hybrid-season',
      status: 'ACTIVE',
      providers: [providerConfig],
      standingsRule: 'LEGACY',
    });
    mocks.runFindUnique.mockResolvedValue(null);
    mocks.runFindFirst.mockResolvedValue(null);
    mocks.registryCreate.mockReturnValue({
      provider: { name: providerConfig.key, source: 'fixture://hybrid' },
      afterSync: mocks.afterSync,
    });
    mocks.runProviderSync
      .mockResolvedValueOnce(summary('RESULTS', 1))
      .mockResolvedValueOnce(summary('STANDINGS', 2));
    mocks.enqueue
      .mockResolvedValueOnce({ id: 'event-match' })
      .mockResolvedValueOnce({ id: 'event-sync' });
    mocks.transaction.mockImplementation((callback: (tx: object) => unknown) => callback({}));
    mocks.scoreSyncSetting.mockResolvedValue({ enabled: true });
    mocks.listRuntime.mockResolvedValue([]);
    mocks.competitionFlags.mockResolvedValue({ syncEnabled: true });
  });

  it('usa somente o provider registrado na metadata da temporada fictícia', async () => {
    const result = await syncOfficialSeasonResults({
      seasonId: 'hybrid-season',
      userId: 'user-1',
      idempotencyKey: 'request-123',
    });

    expect(mocks.registryCreate).toHaveBeenCalledWith(providerConfig);
    expect(mocks.runProviderSync.mock.calls.map((call) => call[1].type)).toEqual([
      'RESULTS',
      'STANDINGS',
    ]);
    expect(mocks.runProviderSync.mock.calls[0]?.[0].name).toBe('fixture-hybrid-provider');
    expect(JSON.stringify(mocks.runProviderSync.mock.calls)).not.toContain('cbf');
    expect(result).toMatchObject({ status: 'UPDATED', changedMatches: 1 });
  });

  it('falha fechado quando metadata não configura provider', async () => {
    mocks.getRuntime.mockResolvedValueOnce({
      seasonId: 'no-provider',
      status: 'ACTIVE',
      providers: [],
      standingsRule: 'LEGACY',
    });
    await expect(
      syncOfficialSeasonResults({
        seasonId: 'no-provider',
        userId: 'user-1',
        idempotencyKey: 'request-123',
      }),
    ).rejects.toMatchObject({ code: 'SEASON_PROVIDER_NOT_CONFIGURED' });
    expect(mocks.registryCreate).not.toHaveBeenCalled();
  });

  it('agenda todas as temporadas ativas configuradas e isola falhas', async () => {
    mocks.listRuntime.mockResolvedValue([
      { seasonId: 'season-a', providers: [providerConfig] },
      { seasonId: 'season-b', providers: [providerConfig] },
    ]);
    mocks.getRuntime.mockImplementation(async (seasonId: string) => ({
      seasonId,
      status: 'ACTIVE',
      providers: [providerConfig],
      standingsRule: 'LEGACY',
    }));
    mocks.runProviderSync.mockReset();
    mocks.runProviderSync.mockImplementation(
      async (_provider: unknown, input: { seasonId: string; type: 'RESULTS' | 'STANDINGS' }) => {
        if (input.seasonId === 'season-a' && input.type === 'RESULTS') throw new Error('offline');
        return summary(input.type, 0, input.seasonId);
      },
    );
    mocks.enqueue.mockResolvedValue({ id: 'event' });

    const results = await runAutomaticSeasonSyncs();

    expect(results).toHaveLength(2);
    expect(results.find((item) => item.seasonId === 'season-a')).toMatchObject({ ok: false });
    expect(results.find((item) => item.seasonId === 'season-b')).toMatchObject({ ok: true });
    expect(mocks.runProviderSync.mock.calls.some((call) => call[1].seasonId === 'season-b')).toBe(
      true,
    );
  });
});
