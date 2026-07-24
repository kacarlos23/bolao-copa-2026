import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../../prisma.js', () => ({
  prisma: { poolSeasonFundraising: { findUnique: mocks.findUnique } },
}));

import {
  fundraisingAmountCentsSchema,
  fundraisingDto,
  getPoolSeasonFundraising,
} from './fundraising.service.js';

describe('PoolSeason fundraising', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves integer cents and scopes reads by PoolSeason', async () => {
    mocks.findUnique.mockResolvedValue({
      amountCents: 15_050,
      updatedAt: new Date('2026-07-24T12:00:00.000Z'),
      updatedById: 'admin-1',
      lastJustification: 'Valor confirmado pelo administrador',
    });

    await expect(getPoolSeasonFundraising('pool-season-a')).resolves.toMatchObject({
      poolSeasonId: 'pool-season-a',
      amountCents: 15_050,
    });
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { poolSeasonId: 'pool-season-a' } }),
    );
  });

  it('returns zero without manufacturing a shared global setting', () => {
    expect(fundraisingDto('pool-season-b', null)).toMatchObject({
      poolSeasonId: 'pool-season-b',
      amountCents: 0,
      updatedAt: null,
    });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 100_000_001])(
    'rejects invalid cents value %s',
    (value) => {
      expect(fundraisingAmountCentsSchema.safeParse(value).success).toBe(false);
    },
  );
});
