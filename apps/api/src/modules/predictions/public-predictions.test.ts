import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMatch: vi.fn(),
  listPublic: vi.fn(),
  closeMinutes: vi.fn(),
}));

vi.mock('./prediction.repository.js', () => ({
  findMatchForPublicPredictions: mocks.findMatch,
  listPublicMatchPredictionRecords: mocks.listPublic,
  listPredictionRecords: vi.fn(),
}));

vi.mock('../../services/prediction-settings.service.js', () => ({
  DEFAULT_PREDICTION_CLOSE_MINUTES: 5,
  MAX_PREDICTION_CLOSE_MINUTES: 1440,
  MIN_PREDICTION_CLOSE_MINUTES: 0,
  PREDICTION_CLOSE_MINUTES_KEY: 'prediction-close-minutes',
  getPredictionCloseMinutes: mocks.closeMinutes,
}));

vi.mock('../engagement/engagement.service.js', () => ({
  recomputePoolSeasonEngagement: vi.fn(),
}));

import { listPublicMatchPredictions } from './prediction.use-cases.js';

const context = {
  poolId: 'pool-1',
  poolSlug: 'pool-a',
  poolSeasonId: 'pool-season-1',
  seasonId: 'season-1',
  membershipRole: 'MEMBER' as const,
  systemRole: 'USER' as const,
  scoreableFromRound: null,
  scoreableFrom: null,
  startsAtRound: null,
  historicalMatchesScoreable: false,
};

function prediction(id: string, userId: string, home: number, away: number) {
  return {
    id,
    userId,
    matchId: 'match-1',
    predictedHomeScore: home,
    predictedAwayScore: away,
    user: { id: userId, nickname: userId, avatarUrl: null },
  };
}

describe('public match predictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeMinutes.mockResolvedValue(5);
    mocks.findMatch.mockResolvedValue({
      id: 'match-1',
      startsAt: new Date('2026-07-17T22:00:00.000Z'),
      predictionClosesAt: new Date('2026-07-17T21:55:00.000Z'),
      status: 'LIVE',
      homeScore: 2,
      awayScore: 1,
      finalHomeScore: null,
      finalAwayScore: null,
    });
  });

  it('does not query or expose participant predictions before the deadline', async () => {
    await expect(
      listPublicMatchPredictions(context, 'match-1', new Date('2026-07-17T21:54:59.000Z')),
    ).rejects.toMatchObject({ code: 'PREDICTIONS_NOT_PUBLIC', statusCode: 403 });
    expect(mocks.listPublic).not.toHaveBeenCalled();
  });

  it('classifies the four result categories from the current live score', async () => {
    mocks.listPublic.mockResolvedValue([
      prediction('prediction-exact', 'exact', 2, 1),
      prediction('prediction-result', 'result', 3, 0),
      prediction('prediction-one-goal', 'one-goal', 2, 3),
      prediction('prediction-miss', 'miss', 0, 4),
    ]);

    const result = await listPublicMatchPredictions(
      context,
      'match-1',
      new Date('2026-07-17T21:55:00.000Z'),
    );

    expect(result.predictions.map((item) => item.scoreType)).toEqual([
      'EXACT_SCORE',
      'RESULT',
      'ONE_TEAM_GOALS',
      'MISS',
    ]);
    expect(mocks.listPublic).toHaveBeenCalledWith(context, 'match-1');
  });

  it('keeps predictions neutral after closing while the official score is unavailable', async () => {
    mocks.findMatch.mockResolvedValue({
      id: 'match-1',
      startsAt: new Date('2026-07-17T22:00:00.000Z'),
      predictionClosesAt: new Date('2026-07-17T21:55:00.000Z'),
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      finalHomeScore: null,
      finalAwayScore: null,
    });
    mocks.listPublic.mockResolvedValue([prediction('prediction-1', 'participant', 1, 0)]);

    const result = await listPublicMatchPredictions(
      context,
      'match-1',
      new Date('2026-07-17T21:56:00.000Z'),
    );

    expect(result.predictions[0]?.scoreType).toBeNull();
  });
});
