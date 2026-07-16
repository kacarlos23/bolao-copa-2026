import { describe, expect, it } from 'vitest';
import {
  BRASILEIRAO_2026_SCOREABLE_FROM,
  BRASILEIRAO_2026_STARTS_AT_ROUND,
  brasileirao2026PredictionPolicy,
} from './brasileirao-2026.service.js';

describe('Brasileirão 2026 prediction policy', () => {
  it('keeps round 20 as a source-readiness gate and opens predictions by date', () => {
    expect(BRASILEIRAO_2026_STARTS_AT_ROUND).toBe(20);
    expect(brasileirao2026PredictionPolicy()).toEqual({
      scoreableFromRound: null,
      scoreableFrom: BRASILEIRAO_2026_SCOREABLE_FROM,
      startsAtRound: null,
      historicalMatchesScoreable: false,
    });
  });
});
