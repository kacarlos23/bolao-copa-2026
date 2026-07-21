import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('../../prisma.js', () => ({
  prisma: { competitionSeason: { findMany: mocks.findMany } },
}));

import {
  listActiveSeasonRuntimeConfigs,
  parseSeasonRuntimeConfig,
} from './season-runtime-config.js';

describe('metadata transitória de provider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('valida configuração explícita sem consultar slug', () => {
    expect(
      parseSeasonRuntimeConfig({
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
    ).toMatchObject({
      providers: [{ key: 'fixture-provider', types: ['RESULTS'] }],
      standingsRule: 'LEGACY',
    });
  });

  it('lê a metadata oficial legada existente e ignora metadata desconhecida', () => {
    const legacy = parseSeasonRuntimeConfig({
      source: {
        source: 'https://www.cbf.com.br/futebol-brasileiro/competicoes/campeonato-brasileiro-serie-a/2026',
        timezone: 'America/Sao_Paulo',
        roundsFetched: 38,
        standings: 20,
      },
      tieBreakRule: 'cbf-rec-2026-art-15-v1',
    });
    expect(legacy.providers[0]?.key).toBe('cbf-official');
    expect(legacy.standingsRule).toBe('CBF_SERIE_A_2026');
    expect(parseSeasonRuntimeConfig({ unrelated: true }).providers).toEqual([]);
  });

  it('lista somente temporadas ativas com provider configurado', async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: 'season-active',
        status: 'ACTIVE',
        metadata: { providers: [{ key: 'fixture', types: ['RESULTS'] }] },
      },
    ]);

    await expect(listActiveSeasonRuntimeConfigs()).resolves.toMatchObject([
      { seasonId: 'season-active', providers: [{ key: 'fixture' }] },
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });
});
