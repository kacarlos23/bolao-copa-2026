import { beforeEach, describe, expect, it, vi } from 'vitest';
import { savePredictions } from './prediction.use-cases.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  outboxFindUnique: vi.fn(),
  outboxUpdateMany: vi.fn(),
  outboxUpdate: vi.fn(),
  recomputeEngagement: vi.fn(),
}));

vi.mock('../engagement/engagement.service.js', () => ({
  recomputePoolSeasonEngagement: mocks.recomputeEngagement,
}));

vi.mock('../../prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    outboxEvent: {
      findUnique: mocks.outboxFindUnique,
      updateMany: mocks.outboxUpdateMany,
      update: mocks.outboxUpdate,
    },
  },
}));

function transactionClient(matchSeasonId = 'season-1') {
  return {
    pool: {
      findUnique: vi.fn(async () => ({
        id: 'pool-1',
        slug: 'pool-a',
        memberships: [{ role: 'MEMBER' }],
        seasons: [{ id: 'pool-season-1', seasonId: 'season-1' }],
      })),
    },
    matchDay: {
      findFirst: vi.fn(async () => ({ id: 'day-1' })),
    },
    appSetting: {
      findUnique: vi.fn(async () => ({ value: { minutes: 5 } })),
    },
    match: {
      findMany: vi.fn(async () =>
        matchSeasonId
          ? [
              {
                id: 'match-1',
                startsAt: new Date('2030-07-14T19:05:00.000Z'),
                predictionClosesAt: new Date('2030-07-14T19:00:00.000Z'),
                seasonId: matchSeasonId,
              },
            ]
          : [],
      ),
    },
    prediction: {
      upsert: vi.fn(async () => ({
        id: 'prediction-1',
        poolSeasonId: 'pool-season-1',
        userId: 'user-1',
        matchId: 'match-1',
        predictedHomeScore: 1,
        predictedAwayScore: 0,
        updatedAt: new Date('2026-07-14T12:00:00.000Z'),
      })),
    },
    outboxEvent: {
      create: vi.fn(async () => ({ id: 'event-1' })),
    },
  };
}

const input = {
  poolSlug: 'pool-a',
  seasonId: 'season-1',
  userId: 'user-1',
  body: {
    matchDayId: 'day-1',
    predictions: [{ matchId: 'match-1', predictedHomeScore: 1, predictedAwayScore: 0 }],
  },
};

describe('scoped prediction write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outboxFindUnique.mockResolvedValue({
      id: 'event-1',
      type: 'prediction.updated',
      occurredAt: new Date('2026-07-14T12:00:00.000Z'),
      seasonId: 'season-1',
      poolSeasonId: 'pool-season-1',
      version: 1,
      payload: { matchIds: ['match-1'] },
      publishedAt: null,
    });
    mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('proves Match -> Season and publishes the transactional outbox only after commit', async () => {
    const order: string[] = [];
    const tx = transactionClient();
    mocks.transaction.mockImplementation(async (callback) => {
      order.push('transaction');
      const result = await callback(tx);
      order.push('commit');
      return result;
    });
    mocks.outboxFindUnique.mockImplementation(async () => {
      order.push('dispatch');
      return {
        id: 'event-1',
        type: 'prediction.updated',
        occurredAt: new Date('2026-07-14T12:00:00.000Z'),
        seasonId: 'season-1',
        poolSeasonId: 'pool-season-1',
        version: 1,
        payload: { matchIds: ['match-1'] },
        publishedAt: null,
      };
    });

    const result = await savePredictions(input);

    expect(result.predictions).toHaveLength(1);
    expect(tx.prediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          poolSeasonId_userId_matchId: {
            poolSeasonId: 'pool-season-1',
            userId: 'user-1',
            matchId: 'match-1',
          },
        },
      }),
    );
    expect(tx.outboxEvent.create).toHaveBeenCalledOnce();
    expect(order).toEqual(['transaction', 'commit', 'dispatch']);
  });

  it('rejects cross-season matches before writing a prediction or event', async () => {
    const tx = transactionClient('');
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(savePredictions(input)).rejects.toMatchObject({
      code: 'MATCH_SEASON_MISMATCH',
      statusCode: 400,
    });
    expect(tx.prediction.upsert).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(mocks.outboxFindUnique).not.toHaveBeenCalled();
  });
});
