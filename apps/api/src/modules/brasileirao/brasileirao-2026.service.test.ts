import { describe, expect, it } from 'vitest';
import {
  BRASILEIRAO_2026_STARTS_AT_ROUND,
  brasileirao2026PredictionPolicy,
} from './brasileirao-2026.service.js';

describe('Brasileirão 2026 prediction policy', () => {
  it('starts scoring at round 20 regardless of a postponed match date', () => {
    expect(BRASILEIRAO_2026_STARTS_AT_ROUND).toBe(20);
    expect(brasileirao2026PredictionPolicy()).toEqual({
      scoreableFromRound: 20,
      scoreableFrom: null,
      startsAtRound: 20,
      historicalMatchesScoreable: false,
    });
  });
});
