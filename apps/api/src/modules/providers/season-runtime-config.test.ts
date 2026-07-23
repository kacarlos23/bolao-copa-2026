import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findMany: vi.fn() }));

vi.mock('../../prisma.js', () => ({
  prisma: {
    competitionSeason: { findUnique: mocks.findUnique, findMany: mocks.findMany },
  },
}));

import {
  assertConfiguredProvider,
  getSeasonRuntimeConfig,
  listActiveSeasonRuntimeConfigs,
  parseLegacySeasonProviderMetadataForMigration,
} from './season-runtime-config.js';

const persistedConfig = {
  providerKey: 'fixture-provider',
  priority: 2,
  enabledTypes: ['RESULTS'],
  active: true,
  cadenceSeconds: 300,
  timeoutMs: 8_000,
  includeProfiles: false,
  source: 'fixture://provider',
  provenance: 'test',
  settings: {},
};

describe('configuracao persistida de provider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mantem um leitor explicito somente para a migration da metadata do Prompt 1', () => {
    expect(
      parseLegacySeasonProviderMetadataForMigration({
        providers: [
          {
            key: 'fixture-provider',
            priority: 2,
            types: ['RESULTS'],
            enabled: true,
            timeoutMs: 8_000,
            includeProfiles: false,
          },
        ],
      }),
    ).toMatchObject([{ key: 'fixture-provider', types: ['RESULTS'] }]);
  });

  it('seleciona exclusivamente SeasonProviderConfig e nao a metadata de provider', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'season-active',
      status: 'ACTIVE',
      metadata: {
        providers: [{ key: 'metadata-must-not-win', types: ['RESULTS'] }],
        tieBreakRule: 'cbf-rec-2026-art-15-v1',
      },
      providerConfigs: [persistedConfig],
    });

    await expect(getSeasonRuntimeConfig('season-active')).resolves.toMatchObject({
      providers: [{ key: 'fixture-provider', types: ['RESULTS'] }],
      standingsRule: 'CBF_SERIE_A_2026',
    });
  });

  it('lista somente temporadas ativas que possuem configuracao persistida ativa', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'season-active',
        status: 'ACTIVE',
        metadata: {},
        providerConfigs: [persistedConfig],
      },
    ]);

    await expect(listActiveSeasonRuntimeConfigs()).resolves.toMatchObject([
      { seasonId: 'season-active', providers: [{ key: 'fixture-provider' }] },
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ACTIVE', providerConfigs: { some: { active: true } } },
      }),
    );
  });

  it('autoriza fallback CSV/manual somente quando declarado na configuração persistida', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'season-active',
      status: 'ACTIVE',
      metadata: {},
      providerConfigs: [
        {
          ...persistedConfig,
          settings: { fallbackProviders: ['csv', 'manual'] },
        },
      ],
    });

    await expect(
      assertConfiguredProvider('season-active', 'csv', 'RESULTS'),
    ).resolves.toMatchObject({ key: 'fixture-provider' });
    await expect(
      assertConfiguredProvider('season-active', 'unapproved-fallback', 'RESULTS'),
    ).rejects.toMatchObject({ code: 'SEASON_PROVIDER_NOT_CONFIGURED' });
  });
});
