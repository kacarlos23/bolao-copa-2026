import { describe, expect, it } from 'vitest';
import { calculatePredictionScore } from './scoring.js';

describe('calculatePredictionScore', () => {
  it('gives 7 points for exact score', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 2,
        predictedAwayScore: 1,
        actualHomeScore: 2,
        actualAwayScore: 1,
      }),
    ).toEqual({ points: 7, scoreType: 'EXACT_SCORE' });
  });

  it('gives 3 points for correct winner with wrong score', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 3,
        predictedAwayScore: 1,
        actualHomeScore: 2,
        actualAwayScore: 0,
      }),
    ).toEqual({ points: 3, scoreType: 'RESULT' });
  });

  it('gives 3 points for correct draw with wrong score', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 1,
        predictedAwayScore: 1,
        actualHomeScore: 2,
        actualAwayScore: 2,
      }),
    ).toEqual({ points: 3, scoreType: 'RESULT' });
  });

  it('gives 1 point for one team goals when result is wrong', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 1,
        predictedAwayScore: 0,
        actualHomeScore: 1,
        actualAwayScore: 2,
      }),
    ).toEqual({ points: 1, scoreType: 'ONE_TEAM_GOALS' });
  });

  it('gives 0 points when everything is wrong', () => {
    expect(
      calculatePredictionScore({
        predictedHomeScore: 4,
        predictedAwayScore: 1,
        actualHomeScore: 0,
        actualAwayScore: 2,
      }),
    ).toEqual({ points: 0, scoreType: 'MISS' });
  });
});
