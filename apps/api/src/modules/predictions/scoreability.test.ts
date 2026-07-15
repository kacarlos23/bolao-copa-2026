import { describe, expect, it } from 'vitest';
import { isPoolMatchScoreable } from './scoreability.js';

const policy = {
  scoreableFromRound: 20,
  startsAtRound: 20,
  scoreableFrom: new Date('2026-07-25T21:30:00.000Z'),
  historicalMatchesScoreable: false,
};

describe('PoolSeason scoreability gate', () => {
  it('keeps historical matches in the season but outside pool scoring', () => {
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 19,
        startsAt: new Date('2026-07-16T22:30:00.000Z'),
      }),
    ).toBe(false);
  });

  it('accepts the reconciled opening round and rejects a date before its source-derived cutoff', () => {
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 20,
        startsAt: new Date('2026-07-25T21:30:00.000Z'),
      }),
    ).toBe(true);
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 20,
        startsAt: new Date('2026-07-25T20:00:00.000Z'),
      }),
    ).toBe(false);
  });
});
