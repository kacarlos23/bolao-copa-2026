import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configFind: vi.fn(),
  accountFind: vi.fn(),
  membershipUpsert: vi.fn(),
  auditCreate: vi.fn(),
}));

const tx = {
  poolSeasonContributionConfig: { findUnique: mocks.configFind },
  poolSeasonContributionAccount: { findUnique: mocks.accountFind },
  poolSeasonMembership: { upsert: mocks.membershipUpsert },
  adminAuditLog: { create: mocks.auditCreate },
};

vi.mock('../prisma.js', () => ({
  prisma: {
    $transaction: async (operation: (database: typeof tx) => Promise<unknown>) => operation(tx),
  },
}));

import { setPoolSeasonMemberStatus } from './admin.service.js';

describe('contribution-aware membership lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membershipUpsert.mockResolvedValue({ userId: 'user-1', status: 'ACTIVE', role: 'MEMBER' });
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
  });

  it('keeps generic competition membership updates unchanged', async () => {
    mocks.configFind.mockResolvedValue(null);

    await expect(
      setPoolSeasonMemberStatus('admin-1', 'generic-pool-season', 'user-1', 'ACTIVE'),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(mocks.accountFind).not.toHaveBeenCalled();
  });

  it('requires a configured start round before activating in the contribution competition', async () => {
    mocks.configFind.mockResolvedValue({ defaultStartRound: 20 });
    mocks.accountFind.mockResolvedValue(null);

    await expect(
      setPoolSeasonMemberStatus('admin-1', 'pool-season-1', 'user-1', 'ACTIVE'),
    ).rejects.toMatchObject({ code: 'CONTRIBUTION_ACCOUNT_REQUIRED_FOR_ACTIVATION' });
    expect(mocks.membershipUpsert).not.toHaveBeenCalled();
  });

  it('requires an end round before deactivating or removing', async () => {
    mocks.configFind.mockResolvedValue({ defaultStartRound: 20 });
    mocks.accountFind.mockResolvedValue({ startRound: 20, endRound: null });

    await expect(
      setPoolSeasonMemberStatus('admin-1', 'pool-season-1', 'user-1', 'INACTIVE'),
    ).rejects.toMatchObject({ code: 'CONTRIBUTION_END_ROUND_REQUIRED_FOR_DEACTIVATION' });
  });
});
