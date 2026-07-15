import { describe, expect, it } from 'vitest';
import { planScoreTransition, type ScoreState } from './score-recomputation.logic.js';
import { scoreCalculationKey } from './scoring-rules.service.js';

function state(overrides: Partial<ScoreState> = {}): ScoreState {
  return { poolSeasonId: 'pool-season-a', targetId: 'prediction-a', calculationKey: 'calc-a', points: 15, scoringVersion: 1, ...overrides };
}

describe('score recomputation transitions', () => {
  it('makes replay and concurrent delivery idempotent', () => {
    const transitions = Array.from({ length: 20 }, () => planScoreTransition(null, state(), 'result-v1'));
    expect(new Set(transitions.flatMap((item) => item.changed ? [item.idempotencyKey] : [])).size).toBe(1);
    expect(planScoreTransition(state(), state(), 'result-v1')).toEqual({ changed: false });
  });

  it('audits correction and reversal as distinct reversible transitions', () => {
    const original = state();
    const corrected = state({ calculationKey: 'calc-b', points: 3 });
    const correction = planScoreTransition(original, corrected, 'result-v2');
    const reversal = planScoreTransition(corrected, original, 'result-v3');
    expect(correction.changed && correction.before).toEqual(original);
    expect(reversal.changed && reversal.after).toEqual(original);
    expect(correction.changed && reversal.changed && correction.idempotencyKey).not.toBe(reversal.changed && reversal.idempotencyKey);
  });

  it('isolates identical targets from different PoolSeasons', () => {
    const first = planScoreTransition(null, state({ poolSeasonId: 'pool-a' }), 'same-result');
    const second = planScoreTransition(null, state({ poolSeasonId: 'pool-b' }), 'same-result');
    expect(first.changed && second.changed && first.idempotencyKey).not.toBe(second.changed && second.idempotencyKey);
  });

  it('keeps the historical score attached to version 1 when version 2 is introduced', () => {
    const historical = state({ scoringVersion: 1, points: 15 });
    const versionTwoExists = state({ scoringVersion: 2, points: 20, calculationKey: 'new-prediction' });
    expect(historical).toMatchObject({ scoringVersion: 1, points: 15 });
    expect(versionTwoExists).toMatchObject({ scoringVersion: 2, points: 20 });
  });

  it('ignores transport replay revisions but changes and reverses with result state', () => {
    const key = (actualHomeScore: number, resultRevision: string) => scoreCalculationKey({
      targetId: 'prediction-a',
      resultRevision,
      scoringRuleSetVersionId: 'rule-v1',
      actualHomeScore,
      actualAwayScore: 0,
      isFinal: true,
      predictionIdentity: { home: 1, away: 0 },
    });
    const original = key(1, 'provider-delivery-1');
    expect(key(1, 'provider-delivery-2')).toBe(original);
    expect(key(2, 'correction')).not.toBe(original);
    expect(key(1, 'reversal')).toBe(original);
  });
});
