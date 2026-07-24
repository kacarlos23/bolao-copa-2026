import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditFind: vi.fn(),
  recalculate: vi.fn(),
  refresh: vi.fn(),
  engagement: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: { adminAuditLog: { findUnique: mocks.auditFind } },
}));
vi.mock('../../services/ranking.service.js', () => ({
  recalculateScoresForMatch: mocks.recalculate,
  refreshRankingSnapshot: mocks.refresh,
}));
vi.mock('../engagement/engagement.service.js', () => ({
  recomputePoolSeasonEngagement: mocks.engagement,
}));

import { reprocessBrasileirao2026Ranking } from './brasileirao-2026-reprocessing.service.js';

describe('Brasileirão 2026 ranking reprocessing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('replays the audited result for the same idempotency key without recalculating twice', async () => {
    mocks.auditFind.mockResolvedValue({
      id: 'audit-1',
      seasonId: 'season-1',
      poolSeasonId: 'pool-season-1',
      after: { scores: 10, ineligibleScores: 0 },
    });

    await expect(
      reprocessBrasileirao2026Ranking({ idempotencyKey: 'same-operation-key' }),
    ).resolves.toEqual({
      replayed: true,
      seasonId: 'season-1',
      poolSeasonId: 'pool-season-1',
      auditId: 'audit-1',
      summary: { scores: 10, ineligibleScores: 0 },
    });
    expect(mocks.auditFind).toHaveBeenCalledWith({
      where: { idempotencyKey: 'audit:same-operation-key' },
    });
    expect(mocks.recalculate).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.engagement).not.toHaveBeenCalled();
  });
});
