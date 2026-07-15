import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  calculatePredictionScore,
  compareByTieBreakers,
  INITIAL_SCORING_RULE_SET,
} from './scoring.js';

describe('calculatePredictionScore', () => {
  it('gives 15 points for exact score', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 2,
        predictedAwayScore: 1,
        actualHomeScore: 2,
        actualAwayScore: 1,
      }),
    ).toMatchObject({ points: 15, scoreType: 'EXACT_SCORE' });
  });

  it('gives 3 points for correct winner with wrong score', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 3,
        predictedAwayScore: 1,
        actualHomeScore: 2,
        actualAwayScore: 0,
      }),
    ).toMatchObject({ points: 3, scoreType: 'RESULT' });
  });

  it('gives 3 points for correct draw with wrong score', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 1,
        predictedAwayScore: 1,
        actualHomeScore: 2,
        actualAwayScore: 2,
      }),
    ).toMatchObject({ points: 3, scoreType: 'RESULT' });
  });

  it('gives 1 point for one team goals when result is wrong', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 1,
        predictedAwayScore: 0,
        actualHomeScore: 1,
        actualAwayScore: 2,
      }),
    ).toMatchObject({ points: 1, scoreType: 'ONE_TEAM_GOALS' });
  });

  it('gives 0 points when everything is wrong', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 4,
        predictedAwayScore: 1,
        actualHomeScore: 0,
        actualAwayScore: 2,
      }),
    ).toMatchObject({ points: 0, scoreType: 'MISS' });
  });

  it('uses an explicit version without changing the historical initial version', () => {
    const custom = {
      ...INITIAL_SCORING_RULE_SET,
      id: 'v2',
      version: 2,
      rules: { exactScore: 20, correctOutcome: 5, oneTeamGoals: 2, miss: 0 },
    };
    const input = {
      predictedHomeScore: 2,
      predictedAwayScore: 1,
      actualHomeScore: 2,
      actualAwayScore: 1,
    };
    expect(calculatePredictionScore(input, custom).points).toBe(20);
    expect(calculatePredictionScore(input, INITIAL_SCORING_RULE_SET).points).toBe(15);
  });

  it('keeps genuine ties shared instead of using nickname as a criterion', () => {
    const tied = { points: 10, exactScores: 1, resultHits: 2, oneGoalHits: 1, misses: 0 };
    expect(compareByTieBreakers(tied, { ...tied })).toBe(0);
  });

  it('is deterministic and always selects exactly one configured rule (property)', () => {
    fc.assert(
      fc.property(
        fc.record({
          predictedHomeScore: fc.integer({ min: 0, max: 20 }),
          predictedAwayScore: fc.integer({ min: 0, max: 20 }),
          actualHomeScore: fc.integer({ min: 0, max: 20 }),
          actualAwayScore: fc.integer({ min: 0, max: 20 }),
        }),
        (input) => {
          const first = calculatePredictionScore(input, INITIAL_SCORING_RULE_SET);
          const replay = calculatePredictionScore({ ...input }, INITIAL_SCORING_RULE_SET);
          expect(replay).toEqual(first);
          expect(first.breakdown.awardedPoints).toBe(first.points);
          expect(['EXACT_SCORE', 'RESULT', 'ONE_TEAM_GOALS', 'MISS']).toContain(first.scoreType);
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it('honors arbitrary non-negative rule values and tie ordering (property)', () => {
    fc.assert(fc.property(
      fc.record({ exactScore: fc.nat(100), correctOutcome: fc.nat(100), oneTeamGoals: fc.nat(100), miss: fc.nat(100) }),
      fc.record({ points: fc.integer(), exactScores: fc.nat(), resultHits: fc.nat(), oneGoalHits: fc.nat(), misses: fc.nat() }),
      fc.record({ points: fc.integer(), exactScores: fc.nat(), resultHits: fc.nat(), oneGoalHits: fc.nat(), misses: fc.nat() }),
      (rules, left, right) => {
        const ruleSet = { ...INITIAL_SCORING_RULE_SET, id: 'property', rules };
        expect(calculatePredictionScore({ predictedHomeScore: 1, predictedAwayScore: 0, actualHomeScore: 1, actualAwayScore: 0 }, ruleSet).points).toBe(rules.exactScore);
        expect(Math.sign(compareByTieBreakers(left, right))).toBe(-Math.sign(compareByTieBreakers(right, left)));
      },
    ));
  });
});
