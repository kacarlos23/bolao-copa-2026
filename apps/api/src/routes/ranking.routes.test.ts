import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import { rankingRouter } from './ranking.routes.js';

const mockAwards = vi.hoisted(() => [
  {
    key: 'overall_champion',
    title: 'Campeao Geral',
    subtitle: 'Trofeu maximo do bolao',
    scope: 'OVERALL',
    tier: 'legendary',
    status: 'live',
    icon: 'trophy',
    winner: {
      userId: 'user-1',
      nickname: 'Ana',
      avatarUrl: null,
      points: 42,
      exactScores: 3,
      resultHits: 4,
      oneGoalHits: 2,
      misses: 1,
    },
  },
]);

vi.mock('../services/ranking.service.js', () => ({
  getRanking: vi.fn(async () => []),
  getRankingAwards: vi.fn(async () => mockAwards),
}));

vi.mock('../services/ge-score-sync.service.js', () => ({
  runGeScoreScrapeOnce: vi.fn(async () => ({
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    scraped: 0,
    topScorers: null,
    changedEntries: 0,
    updatedMatches: 0,
    updatedKnockoutFixtures: 0,
  })),
}));

vi.mock('../prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        id: 'user-1',
        username: 'ana',
        nickname: 'Ana',
        avatarUrl: null,
        role: 'USER',
        status: 'ACTIVE',
        sessionVersion: 1,
      })),
    },
  },
}));

function createRankingTestApp(authenticated: boolean) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      session: authenticated
        ? {
            user: {
              id: 'user-1',
              username: 'ana',
              nickname: 'Ana',
              avatarUrl: null,
              role: 'USER',
              status: 'ACTIVE',
              sessionVersion: 1,
            },
            destroy: (callback: (error?: unknown) => void) => callback(),
          }
        : {},
    });
    next();
  });
  app.use('/api/ranking', rankingRouter);
  app.use(errorHandler);
  return app;
}

describe('ranking routes', () => {
  it('protects awards behind authentication', async () => {
    const response = await request(createRankingTestApp(false)).get('/api/ranking/awards');

    expect(response.status).toBe(401);
  });

  it('returns ranking awards for authenticated users', async () => {
    const response = await request(createRankingTestApp(true)).get('/api/ranking/awards');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ awards: mockAwards });
  });
});
