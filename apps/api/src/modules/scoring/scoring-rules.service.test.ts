import { describe, expect, it, vi } from 'vitest';
import { resolvePoolSeasonRules } from './scoring-rules.service.js';

describe('resolvePoolSeasonRules', () => {
  it('exposes the authoritative prediction policy with an ISO cutoff', async () => {
    const database = {
      poolSeason: {
        findUnique: vi.fn(async () => ({
          id: 'pool-season-1',
          scoreableFrom: new Date('2026-07-16T03:00:00.000Z'),
          scoreableFromRound: null,
          startsAtRound: null,
          historicalMatchesScoreable: false,
          scoringRuleSetVersion: {
            id: 'scoring-1',
            key: 'classic',
            name: 'Clássica',
            version: 1,
            rules: { exactScore: 15, correctOutcome: 3, oneTeamGoals: 1, miss: 0 },
          },
          tieBreakerRuleSet: {
            id: 'tie-1',
            key: 'classic',
            name: 'Clássico',
            version: 1,
            criteria: [{ field: 'points', direction: 'desc', label: 'Pontos' }],
            allowSharedPositions: true,
          },
        })),
      },
      scoringRuleSetVersion: { findUnique: vi.fn() },
      tieBreakerRuleSet: { findUnique: vi.fn() },
    } as unknown as Parameters<typeof resolvePoolSeasonRules>[1];

    await expect(resolvePoolSeasonRules('pool-season-1', database)).resolves.toMatchObject({
      predictionPolicy: {
        scoreableFrom: '2026-07-16T03:00:00.000Z',
        scoreableFromRound: null,
        startsAtRound: null,
        historicalMatchesScoreable: false,
      },
    });
  });
});
