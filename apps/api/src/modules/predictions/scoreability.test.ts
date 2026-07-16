import { describe, expect, it } from 'vitest';
import { isPoolMatchScoreable } from './scoreability.js';

const policy = {
  scoreableFromRound: 20,
  startsAtRound: 20,
  scoreableFrom: new Date('2026-07-16T03:00:00.000Z'),
  historicalMatchesScoreable: false,
};

describe('PoolSeason scoreability gate', () => {
  it('uses the temporal cutoff before the legacy round gate', () => {
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 19,
        startsAt: new Date('2026-07-16T02:59:59.999Z'),
      }),
    ).toBe(false);

    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 19,
        startsAt: new Date('2026-07-16T22:30:00.000Z'),
      }),
    ).toBe(true);
  });

  it('accepts a postponed old-round match played after the pool opened', () => {
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 4,
        startsAt: new Date('2026-07-17T22:30:00.000Z'),
      }),
    ).toBe(true);
  });

  it('falls back to the round gate when no temporal cutoff is configured', () => {
    const roundOnlyPolicy = { ...policy, scoreableFrom: null };

    expect(
      isPoolMatchScoreable(roundOnlyPolicy, {
        roundOrder: 19,
        startsAt: new Date('2026-07-25T21:30:00.000Z'),
      }),
    ).toBe(false);
    expect(
      isPoolMatchScoreable(roundOnlyPolicy, {
        roundOrder: 20,
        startsAt: new Date('2026-07-25T21:30:00.000Z'),
      }),
    ).toBe(true);
  });
});
