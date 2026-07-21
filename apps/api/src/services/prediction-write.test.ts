import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertPredictions } from './prediction.service.js';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  settingFindUnique: vi.fn(),
}));

vi.mock('../prisma.js', () => ({
  prisma: {
    $transaction: mocks.transaction,
    appSetting: { findUnique: mocks.settingFindUnique },
  },
}));

function transactionClient(closesAt: Date, role: 'USER' | 'ADMIN' = 'USER') {
  return {
    user: {
      findUnique: vi.fn(async () => ({ role, status: 'ACTIVE' })),
    },
    matchDay: {
      findUnique: vi.fn(async () => ({
        id: 'day-1',
        matches: [
          {
            id: 'match-1',
            startsAt: new Date('2026-07-14T19:05:00.000Z'),
            predictionClosesAt: closesAt,
          },
        ],
      })),
    },
    prediction: {
      upsert: vi.fn(async () => ({ id: 'prediction-1', matchId: 'match-1' })),
    },
  };
}

const input = {
  predictions: [{ matchId: 'match-1', predictedHomeScore: 1, predictedAwayScore: 0 }],
};

describe('atomic prediction closing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.settingFindUnique.mockResolvedValue({ value: { minutes: 5 }, updatedAt: new Date() });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('writes immediately before the boundary in a SERIALIZABLE transaction', async () => {
    const closesAt = new Date('2026-07-14T19:00:00.000Z');
    vi.setSystemTime(new Date(closesAt.getTime() - 1));
    const tx = transactionClient(closesAt);
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(upsertPredictions('day-1', 'user-1', input)).resolves.toHaveLength(1);
    expect(tx.prediction.upsert).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('allows active admins to write predictions before the boundary', async () => {
    const closesAt = new Date('2026-07-14T19:00:00.000Z');
    vi.setSystemTime(new Date(closesAt.getTime() - 1));
    const tx = transactionClient(closesAt, 'ADMIN');
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(upsertPredictions('day-1', 'admin-1', input)).resolves.toHaveLength(1);
    expect(tx.prediction.upsert).toHaveBeenCalledOnce();
  });

  it('fails closed at now >= closesAt after time advances at the transaction boundary', async () => {
    const closesAt = new Date('2026-07-14T19:00:00.000Z');
    vi.setSystemTime(new Date(closesAt.getTime() - 1));
    const tx = transactionClient(closesAt);
    mocks.transaction.mockImplementation(async (callback) => {
      vi.setSystemTime(closesAt);
      return callback(tx);
    });

    await expect(upsertPredictions('day-1', 'user-1', input)).rejects.toMatchObject({
      code: 'PREDICTION_MATCH_CLOSED',
      statusCode: 409,
    });
    expect(tx.prediction.upsert).not.toHaveBeenCalled();
  });
});
