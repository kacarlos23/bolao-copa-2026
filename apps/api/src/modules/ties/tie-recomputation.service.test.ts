import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { recomputeTieInTransaction } from './tie-recomputation.service.js';

describe('recomputeTieInTransaction', () => {
  it('clears a provider-like sporting promotion when match data is insufficient', async () => {
    const update = vi.fn(async (input) => input.data);
    const tx = {
      tie: {
        findUnique: vi.fn(async () => ({
          id: 'tie-1',
          teamAId: 'team-a',
          teamBId: 'team-b',
          expectedLegs: 1,
          status: 'DECIDED',
          decisionMethod: 'PENALTIES',
          winnerTeamId: 'team-a',
          decidedAt: new Date('2026-07-21T10:00:00.000Z'),
          matches: [
            {
              id: 'match-1',
              legNumber: 1,
              status: 'FINISHED',
              homeTeamId: 'team-a',
              awayTeamId: 'team-b',
              regulationHomeScore: 1,
              regulationAwayScore: 1,
              extraTimeHomeScore: null,
              extraTimeAwayScore: null,
              penaltyHomeScore: null,
              penaltyAwayScore: null,
            },
          ],
        })),
        update,
      },
    } as unknown as Prisma.TransactionClient;

    await recomputeTieInTransaction(tx, 'tie-1', new Date('2026-07-21T12:00:00.000Z'));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'tie-1' },
      data: {
        status: 'IN_PROGRESS',
        decisionMethod: null,
        winnerTeamId: null,
        aggregateTeamAScore: 1,
        aggregateTeamBScore: 1,
        decidedAt: null,
        lastRecomputedAt: new Date('2026-07-21T12:00:00.000Z'),
      },
    });
  });
});
