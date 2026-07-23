import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enabledServerRankingScopes, getPoolRanking } from './ranking.use-cases.js';

const mocks = vi.hoisted(() => ({
  season: vi.fn(),
  stage: vi.fn(),
  round: vi.fn(),
  ranking: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: {
    competitionSeason: { findUnique: mocks.season },
    stage: { findFirst: mocks.stage },
    round: { findFirst: mocks.round },
  },
}));

vi.mock('../../services/ranking.service.js', () => ({
  getRanking: mocks.ranking,
  getRankingAwards: vi.fn(),
}));

const rankingContext = {
  seasonId: 'season-cup',
  poolId: 'pool-a',
  poolSeasonId: 'pool-season-cup',
};

describe('ranking scopes declared by season capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ranking.mockResolvedValue([]);
  });

  it('fails closed to overall when configuration is absent or invalid', () => {
    expect(enabledServerRankingScopes(null)).toEqual(new Set(['OVERALL']));
    expect(enabledServerRankingScopes({ rankingScopes: ['TURN'], unknown: true })).toEqual(
      new Set(['OVERALL']),
    );
  });

  it('allows TURN only when the season declares it explicitly', () => {
    expect(
      enabledServerRankingScopes({
        format: 'KNOCKOUT',
        knockout: true,
        rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
      }),
    ).toEqual(new Set(['OVERALL', 'STAGE', 'ROUND']));
    expect(
      enabledServerRankingScopes({
        format: 'LEAGUE',
        rankingScopes: ['OVERALL', 'ROUND', 'MONTH', 'TURN'],
      }),
    ).toEqual(new Set(['OVERALL', 'ROUND', 'MONTH', 'TURN']));
  });

  it('rejects TURN for a knockout season and never queries ranking data', async () => {
    mocks.season.mockResolvedValue({
      capabilities: {
        format: 'KNOCKOUT',
        knockout: true,
        rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
      },
    });

    await expect(
      getPoolRanking(rankingContext, 'all', {
        page: 1,
        pageSize: 100,
        scope: 'turn',
        turn: 1,
      }),
    ).rejects.toMatchObject({ code: 'RANKING_SCOPE_DISABLED', statusCode: 400 });
    expect(mocks.ranking).not.toHaveBeenCalled();
  });

  it('rejects a stage from another season before calculating the ranking', async () => {
    mocks.season.mockResolvedValue({
      capabilities: {
        format: 'GROUPS',
        groupStage: true,
        rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
      },
    });
    mocks.stage.mockResolvedValue(null);

    await expect(
      getPoolRanking(rankingContext, 'all', {
        page: 1,
        pageSize: 100,
        scope: 'stage',
        stageId: 'stage-other-season',
      }),
    ).rejects.toMatchObject({ code: 'RANKING_SCOPE_OUT_OF_SEASON', statusCode: 404 });
    expect(mocks.ranking).not.toHaveBeenCalled();
  });
});
