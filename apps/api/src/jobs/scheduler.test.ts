import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  automaticSyncs: vi.fn(),
  outbox: vi.fn(),
  adminJob: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../modules/providers/season-result-sync.service.js', () => ({
  runAutomaticSeasonSyncs: mocks.automaticSyncs,
}));
vi.mock('../logger.js', () => ({ logger: { info: mocks.info, error: mocks.error } }));
vi.mock('../config.js', () => ({ config: { LIVE_POLL_SECONDS: 15 } }));
vi.mock('../modules/events/outbox.js', () => ({ dispatchPendingOutboxEvents: mocks.outbox }));
vi.mock('../modules/admin/admin-job.service.js', () => ({ runNextAdminJob: mocks.adminJob }));
vi.mock('../modules/providers/provider-utils.js', () => ({
  redactProviderError: () => 'offline',
}));

import { pollConfiguredSeasonProviders, startJobs, stopJobs } from './scheduler.js';

describe('scheduler de providers por temporada', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registra resultados de cada temporada sem condicional por competição', async () => {
    mocks.automaticSyncs.mockResolvedValue([
      {
        seasonId: 'season-hybrid',
        ok: true,
        summary: { changedMatches: 2, updatedProfiles: 0, runs: [] },
        schedule: { providers: [] },
      },
      { seasonId: 'season-offline', ok: false, error: new Error('offline') },
    ]);

    await pollConfiguredSeasonProviders();

    expect(mocks.automaticSyncs).toHaveBeenCalledOnce();
    expect(mocks.info).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: 'season-hybrid', changedMatches: 2 }),
      'automatic season provider sync finished',
    );
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: 'season-offline', error: 'offline' }),
      'automatic season provider sync failed',
    );
  });

  it('impede novos polls e aguarda o poll ativo durante shutdown', async () => {
    let release!: () => void;
    mocks.automaticSyncs.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );
    startJobs();
    const stopping = stopJobs();
    expect(mocks.automaticSyncs).toHaveBeenCalledOnce();
    release();
    await stopping;

    await pollConfiguredSeasonProviders();
    expect(mocks.automaticSyncs).toHaveBeenCalledOnce();
  });
});
