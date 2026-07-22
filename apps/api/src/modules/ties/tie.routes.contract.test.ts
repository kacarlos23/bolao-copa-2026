import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../../middleware/error-handler.js';
import { requestContext } from '../../middleware/request-context.js';
import { seasonRouter } from '../seasons/season.routes.js';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  seasonFindUnique: vi.fn(),
  tieFindMany: vi.fn(),
  tieCount: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    competitionSeason: { findUnique: mocks.seasonFindUnique },
    tie: { findMany: mocks.tieFindMany, count: mocks.tieCount },
  },
}));

const admin = {
  id: 'admin-1',
  username: 'admin',
  nickname: 'Admin',
  avatarUrl: null,
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
  sessionVersion: 1,
};

function createTestApp() {
  const app = express();
  app.use(requestContext);
  app.use((req, _res, next) => {
    Object.assign(req, { session: { user: admin } });
    next();
  });
  app.use('/api/seasons', seasonRouter);
  app.use(errorHandler);
  return app;
}

describe('Tie route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(admin);
    mocks.seasonFindUnique.mockResolvedValue({
      id: 'season-1',
      competitionId: 'competition-1',
      slug: 'season-2026',
      name: 'Season 2026',
      year: 2026,
      timezone: 'America/Sao_Paulo',
      status: 'ACTIVE',
      startsAt: null,
      endsAt: null,
      capabilities: { knockout: true },
      metadata: null,
    });
    const teamA = { id: 'team-a', name: 'A', code: null, flagUrl: null, crestUrl: null };
    const teamB = { id: 'team-b', name: 'B', code: null, flagUrl: null, crestUrl: null };
    mocks.tieFindMany.mockResolvedValue([
      {
        id: 'tie-1',
        seasonId: 'season-1',
        stageId: 'stage-1',
        roundId: 'round-1',
        key: 'final',
        order: 1,
        expectedLegs: 1,
        status: 'DECIDED',
        decisionMethod: 'PENALTIES',
        aggregateTeamAScore: 1,
        aggregateTeamBScore: 1,
        decidedAt: new Date('2026-07-21T12:00:00.000Z'),
        lastRecomputedAt: new Date('2026-07-21T12:00:00.000Z'),
        provenance: 'fixture:test',
        metadata: null,
        teamA,
        teamB,
        winnerTeam: teamA,
        matches: [
          {
            id: 'match-1',
            seasonId: 'season-1',
            stageId: 'stage-1',
            roundId: 'round-1',
            tieId: 'tie-1',
            legNumber: 1,
            matchDayId: 'day-1',
            startsAt: new Date('2026-07-21T10:00:00.000Z'),
            predictionClosesAt: null,
            status: 'FINISHED',
            homeScore: 1,
            awayScore: 1,
            finalHomeScore: null,
            finalAwayScore: null,
            regulationHomeScore: 1,
            regulationAwayScore: 1,
            extraTimeHomeScore: 0,
            extraTimeAwayScore: 0,
            penaltyHomeScore: 5,
            penaltyAwayScore: 4,
            homeTeam: teamA,
            awayTeam: teamB,
          },
        ],
      },
    ]);
    mocks.tieCount.mockResolvedValue(1);
  });

  it('lists season-scoped series with distinct score dimensions', async () => {
    const response = await request(createTestApp()).get(
      '/api/seasons/season-1/ties?page=1&pageSize=20',
    );

    expect(response.status).toBe(200);
    expect(response.body.ties[0]).toMatchObject({
      id: 'tie-1',
      seasonId: 'season-1',
      decisionMethod: 'PENALTIES',
      aggregateTeamAScore: 1,
      matches: [
        {
          regulationHomeScore: 1,
          extraTimeHomeScore: 0,
          penaltyHomeScore: 5,
        },
      ],
    });
    expect(mocks.tieFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { seasonId: 'season-1' } }),
    );
  });

  it('rejects undeclared query expansion before reading ties', async () => {
    const response = await request(createTestApp()).get(
      '/api/seasons/season-1/ties?include=legacyKnockout',
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(mocks.tieFindMany).not.toHaveBeenCalled();
  });
});
