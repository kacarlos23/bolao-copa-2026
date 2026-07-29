import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listMatches: vi.fn(),
  listParticipants: vi.fn(),
  closeMinutes: vi.fn(),
}));

vi.mock('./prediction.repository.js', () => ({
  findMatchForPublicPredictions: vi.fn(),
  listMatchesForPredictionSubmissionStatus: mocks.listMatches,
  listPredictionRecords: vi.fn(),
  listPredictionSubmissionParticipantRecords: mocks.listParticipants,
  listPublicMatchPredictionRecords: vi.fn(),
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

import { listPredictionSubmissionStatus } from './prediction.use-cases.js';

const context = {
  poolId: 'pool-1',
  poolSlug: 'pool-a',
  poolSeasonId: 'pool-season-1',
  seasonId: 'season-1',
  membershipRole: 'MEMBER' as const,
  systemRole: 'USER' as const,
  scoreableFromRound: null,
  scoreableFrom: null,
  startsAtRound: 2,
  historicalMatchesScoreable: false,
};

describe('prediction submission status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.closeMinutes.mockResolvedValue(5);
    mocks.listMatches.mockResolvedValue([
      {
        id: 'match-1',
        startsAt: new Date('2026-07-29T22:30:00.000Z'),
        predictionClosesAt: new Date('2026-07-29T22:25:00.000Z'),
        status: 'SCHEDULED',
        round: { order: 2 },
      },
      {
        id: 'match-2',
        startsAt: new Date('2026-07-30T00:30:00.000Z'),
        predictionClosesAt: new Date('2026-07-30T00:25:00.000Z'),
        status: 'SCHEDULED',
        round: { order: 2 },
      },
    ]);
    mocks.listParticipants.mockResolvedValue([
      {
        userId: 'user-1',
        user: {
          id: 'user-1',
          nickname: 'Ana',
          avatarUrl: '/avatars/ana.webp',
          predictions: [{ matchId: 'match-1' }, { matchId: 'match-2' }],
        },
      },
      {
        userId: 'user-2',
        user: {
          id: 'user-2',
          nickname: 'Bruno',
          avatarUrl: null,
          predictions: [{ matchId: 'match-1' }],
        },
      },
    ]);
  });

  it('returns only identity, avatar and the completion flag for the selected matches', async () => {
    const result = await listPredictionSubmissionStatus(
      context,
      ['match-1', 'match-2', 'match-1'],
      new Date('2026-07-29T21:00:00.000Z'),
    );

    expect(result).toEqual({
      matchIds: ['match-1', 'match-2'],
      requiredPredictions: 2,
      participants: [
        {
          userId: 'user-1',
          nickname: 'Ana',
          avatarUrl: '/avatars/ana.webp',
          hasSavedPredictions: true,
        },
        {
          userId: 'user-2',
          nickname: 'Bruno',
          avatarUrl: null,
          hasSavedPredictions: false,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/predicted(Home|Away)Score/);
    expect(mocks.listParticipants).toHaveBeenCalledWith(context, ['match-1', 'match-2']);
  });

  it('evaluates completion independently for one selected match', async () => {
    mocks.listMatches.mockResolvedValue([
      {
        id: 'match-1',
        startsAt: new Date('2026-07-29T22:30:00.000Z'),
        predictionClosesAt: new Date('2026-07-29T22:25:00.000Z'),
        status: 'SCHEDULED',
        round: { order: 2 },
      },
    ]);

    const result = await listPredictionSubmissionStatus(
      context,
      ['match-1'],
      new Date('2026-07-29T21:00:00.000Z'),
    );

    expect(result.requiredPredictions).toBe(1);
    expect(result.participants).toEqual([
      expect.objectContaining({ nickname: 'Ana', hasSavedPredictions: true }),
      expect.objectContaining({ nickname: 'Bruno', hasSavedPredictions: true }),
    ]);
    expect(mocks.listParticipants).toHaveBeenCalledWith(context, ['match-1']);
  });

  it('keeps only scoreable scheduled matches whose deadline is still open', async () => {
    mocks.listMatches.mockResolvedValue([
      {
        id: 'match-old',
        startsAt: new Date('2026-07-01T22:30:00.000Z'),
        predictionClosesAt: new Date('2026-07-01T22:25:00.000Z'),
        status: 'FINISHED',
        round: { order: 1 },
      },
      {
        id: 'match-cancelled',
        startsAt: new Date('2026-07-29T22:30:00.000Z'),
        predictionClosesAt: new Date('2026-07-29T22:25:00.000Z'),
        status: 'CANCELLED',
        round: { order: 2 },
      },
      {
        id: 'match-live',
        startsAt: new Date('2026-07-29T22:00:00.000Z'),
        predictionClosesAt: new Date('2026-07-29T21:55:00.000Z'),
        status: 'LIVE',
        round: { order: 2 },
      },
      {
        id: 'match-closed',
        startsAt: new Date('2026-07-29T22:30:00.000Z'),
        predictionClosesAt: new Date('2026-07-29T21:50:00.000Z'),
        status: 'SCHEDULED',
        round: { order: 2 },
      },
      {
        id: 'match-open',
        startsAt: new Date('2026-07-29T23:30:00.000Z'),
        predictionClosesAt: null,
        status: 'SCHEDULED',
        round: { order: 2 },
      },
    ]);
    mocks.listParticipants.mockResolvedValue([
      {
        userId: 'user-1',
        user: {
          id: 'user-1',
          nickname: 'Ana',
          avatarUrl: null,
          predictions: [{ matchId: 'match-open' }],
        },
      },
    ]);

    const result = await listPredictionSubmissionStatus(
      context,
      ['match-old', 'match-cancelled', 'match-live', 'match-closed', 'match-open'],
      new Date('2026-07-29T22:00:00.000Z'),
    );

    expect(result.requiredPredictions).toBe(1);
    expect(result.participants[0]?.hasSavedPredictions).toBe(true);
    expect(mocks.listParticipants).toHaveBeenCalledWith(context, ['match-open']);
  });

  it('rejects matches outside the resolved season before reading participants', async () => {
    mocks.listMatches.mockResolvedValue([{ id: 'match-1' }]);

    await expect(
      listPredictionSubmissionStatus(context, ['match-1', 'match-from-another-season']),
    ).rejects.toMatchObject({
      code: 'PREDICTION_STATUS_MATCH_NOT_FOUND',
      statusCode: 404,
    });
    expect(mocks.listParticipants).not.toHaveBeenCalled();
  });
});
