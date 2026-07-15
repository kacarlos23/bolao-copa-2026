import { describe, expect, it } from 'vitest';
import { achievementIdempotencyKey, deriveStreaks, movementDelta } from './gamification.logic.js';

describe('deterministic gamification derivation', () => {
  const base = { userId: 'user-a', startsAt: new Date('2026-07-01T12:00:00Z'), order: 1 };

  it('ignores live scores and orders simultaneous final results by explicit order/key', () => {
    const streaks = deriveStreaks([
      { ...base, eventKey: 'live', points: 15, scoreType: 'EXACT_SCORE', isFinal: false },
      { ...base, eventKey: 'b', order: 2, points: 0, scoreType: 'MISS', isFinal: true },
      { ...base, eventKey: 'a', points: 3, scoreType: 'RESULT', isFinal: true },
    ]);
    expect(streaks.find((item) => item.type === 'ANY_HIT')).toMatchObject({ currentCount: 0, bestCount: 1, lastEventKey: 'b' });
  });

  it('replay derives the same streaks and achievement key', () => {
    const events = [{ ...base, eventKey: 'a', points: 15, scoreType: 'EXACT_SCORE' as const, isFinal: true }];
    expect(deriveStreaks(events)).toEqual(deriveStreaks([...events]));
    expect(achievementIdempotencyKey('ps1', 'u1', 'FIRST_EXACT', 1)).toBe(
      achievementIdempotencyKey('ps1', 'u1', 'FIRST_EXACT', 1),
    );
  });

  it('represents upward movement with a positive delta', () => {
    expect(movementDelta(8, 3)).toBe(5);
    expect(movementDelta(3, 8)).toBe(-5);
  });
});
