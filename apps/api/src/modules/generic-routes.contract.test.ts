import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import { requestContext } from '../middleware/request-context.js';
import { poolRouter } from './pools/pool.routes.js';
import { rankingRouter } from '../routes/ranking.routes.js';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  poolFindUnique: vi.fn(),
  predictionFindMany: vi.fn(),
  predictionCount: vi.fn(),
  getRanking: vi.fn(),
  getRankingAwards: vi.fn(),
}));

vi.mock('../prisma.js', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    pool: { findUnique: mocks.poolFindUnique },
    prediction: {
      findMany: mocks.predictionFindMany,
      count: mocks.predictionCount,
    },
  },
}));

vi.mock('../services/ranking.service.js', () => ({
  getRanking: mocks.getRanking,
  getRankingAwards: mocks.getRankingAwards,
}));

vi.mock('../services/ge-score-sync.service.js', () => ({
  runGeScoreScrapeOnce: vi.fn(),
}));

const sessionUser = {
  id: 'user-1',
  username: 'ana',
  nickname: 'Ana',
  avatarUrl: null,
  role: 'USER' as const,
  status: 'ACTIVE' as const,
  sessionVersion: 1,
};

function poolContext(overrides: { memberships?: unknown[]; seasons?: unknown[] } = {}) {
  return {
    id: 'pool-bolao-do-trabalho',
    slug: 'bolao-do-trabalho',
    memberships: overrides.memberships ?? [{ role: 'MEMBER' }],
    seasons: overrides.seasons ?? [
      {
        id: 'pool-season-bolao-do-trabalho-world-cup-2026',
        seasonId: 'competition-season-world-cup-2026',
      },
    ],
  };
}

function createTestApp(authenticated = true) {
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      session: authenticated
        ? {
            user: sessionUser,
            destroy: (callback: (error?: unknown) => void) => callback(),
          }
        : {},
    });
    next();
  });
  app.use('/api/pools', poolRouter);
  app.use('/api/ranking', rankingRouter);
  app.use(errorHandler);
  return app;
}

describe('generic competition route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(sessionUser);
    mocks.poolFindUnique.mockResolvedValue(poolContext());
    mocks.predictionFindMany.mockResolvedValue([
      {
        id: 'prediction-1',
        poolSeasonId: 'pool-season-bolao-do-trabalho-world-cup-2026',
        userId: 'user-1',
        matchId: 'match-1',
        predictedHomeScore: 2,
        predictedAwayScore: 1,
        updatedAt: new Date('2026-07-14T12:00:00.000Z'),
      },
    ]);
    mocks.predictionCount.mockResolvedValue(1);
    mocks.getRanking.mockResolvedValue([
      {
        rank: 1,
        userId: 'user-1',
        nickname: 'Ana',
        avatarUrl: null,
        points: 10,
        finalPoints: 10,
        played: 1,
        exactScores: 0,
        resultHits: 1,
        oneGoalHits: 0,
        misses: 0,
        lastFive: [10],
        lastFiveMatches: [],
        hasLiveData: false,
      },
    ]);
    mocks.getRankingAwards.mockResolvedValue([]);
  });

  it('requires authentication and returns a safe request-correlated error', async () => {
    const response = await request(createTestApp(false)).get(
      '/api/pools/bolao-do-trabalho/seasons/competition-season-world-cup-2026/predictions',
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      issues: [],
      requestId: response.headers['x-request-id'],
    });
  });

  it('requires active membership and proves PoolSeason belongs to Season', async () => {
    mocks.poolFindUnique.mockResolvedValueOnce(poolContext({ memberships: [] }));
    const forbidden = await request(createTestApp()).get(
      '/api/pools/bolao-do-trabalho/seasons/competition-season-world-cup-2026/predictions',
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('POOL_MEMBERSHIP_REQUIRED');

    mocks.poolFindUnique.mockResolvedValueOnce(poolContext({ seasons: [] }));
    const crossed = await request(createTestApp()).get(
      '/api/pools/bolao-do-trabalho/seasons/other-season/predictions',
    );
    expect(crossed.status).toBe(404);
    expect(crossed.body.error.code).toBe('POOL_SEASON_NOT_FOUND');
    expect(mocks.predictionFindMany).not.toHaveBeenCalled();
  });

  it('returns paginated DTOs and rejects undeclared query expansion', async () => {
    const response = await request(createTestApp()).get(
      '/api/pools/bolao-do-trabalho/seasons/competition-season-world-cup-2026/predictions?page=1&pageSize=20',
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      predictions: [
        {
          id: 'prediction-1',
          poolSeasonId: 'pool-season-bolao-do-trabalho-world-cup-2026',
          userId: 'user-1',
          matchId: 'match-1',
          predictedHomeScore: 2,
          predictedAwayScore: 1,
          updatedAt: '2026-07-14T12:00:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    const invalid = await request(createTestApp()).get(
      '/api/pools/bolao-do-trabalho/seasons/competition-season-world-cup-2026/predictions?include=match',
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps the World Cup ranking alias on the same scoped use case', async () => {
    const generic = await request(createTestApp()).get(
      '/api/pools/bolao-do-trabalho/seasons/competition-season-world-cup-2026/ranking?pageSize=100',
    );
    const legacy = await request(createTestApp()).get('/api/ranking');

    expect(generic.status).toBe(200);
    expect(legacy.status).toBe(200);
    expect(legacy.body.ranking).toEqual(generic.body.ranking);
    expect(mocks.getRanking).toHaveBeenCalledTimes(2);
    expect(mocks.getRanking.mock.calls[0]?.[1]).toEqual(mocks.getRanking.mock.calls[1]?.[1]);
  });
});
