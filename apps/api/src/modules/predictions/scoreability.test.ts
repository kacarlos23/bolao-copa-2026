import { describe, expect, it } from 'vitest';
import { isPoolMatchScoreable } from './scoreability.js';

const policy = {
  scoreableFromRound: 20,
  startsAtRound: 20,
  scoreableFrom: new Date('2026-07-16T03:00:00.000Z'),
  historicalMatchesScoreable: false,
};

describe('PoolSeason scoreability gate', () => {
  it('uses the round cutoff as the source of truth when it is configured', () => {
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 19,
        startsAt: new Date('2026-07-16T22:30:00.000Z'),
      }),
    ).toBe(false);

    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 20,
        startsAt: new Date('2026-07-16T02:59:59.999Z'),
      }),
    ).toBe(true);
  });

  it('rejects a postponed old-round match played after the pool opened', () => {
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 19,
        startsAt: new Date('2026-07-17T22:30:00.000Z'),
      }),
    ).toBe(false);
  });

  it('accepts a postponed round 20 match', () => {
    expect(
      isPoolMatchScoreable(policy, {
        roundOrder: 20,
        startsAt: new Date('2026-09-25T21:30:00.000Z'),
      }),
    ).toBe(true);
  });

  it('falls back to the temporal gate when no round cutoff is configured', () => {
    const dateOnlyPolicy = { ...policy, startsAtRound: null, scoreableFromRound: null };

    expect(
      isPoolMatchScoreable(dateOnlyPolicy, {
        roundOrder: null,
        startsAt: new Date('2026-07-16T02:59:59.999Z'),
      }),
    ).toBe(false);
    expect(
      isPoolMatchScoreable(dateOnlyPolicy, {
        roundOrder: null,
        startsAt: new Date('2026-07-16T03:00:00.000Z'),
      }),
    ).toBe(true);
  });
});
