import { describe, expect, it } from 'vitest';
import { matchScoreForPrediction } from './match-scoring-basis.js';

describe('matchScoreForPrediction', () => {
  it('scores a Tie-linked Match only by regulation, never aggregate, extra time or penalties', () => {
    expect(
      matchScoreForPrediction({
        tieId: 'tie-1',
        status: 'FINISHED',
        homeScore: 4,
        awayScore: 3,
        finalHomeScore: 2,
        finalAwayScore: 1,
        regulationHomeScore: 1,
        regulationAwayScore: 1,
      }),
    ).toEqual({ homeScore: 1, awayScore: 1, basis: 'REGULATION' });
  });

  it('preserves the legacy final-score basis for matches outside a Tie', () => {
    expect(
      matchScoreForPrediction({
        tieId: null,
        status: 'FINISHED',
        homeScore: 1,
        awayScore: 0,
        finalHomeScore: 2,
        finalAwayScore: 0,
        regulationHomeScore: null,
        regulationAwayScore: null,
      }),
    ).toEqual({ homeScore: 2, awayScore: 0, basis: 'LEGACY_FINAL' });
  });
});
