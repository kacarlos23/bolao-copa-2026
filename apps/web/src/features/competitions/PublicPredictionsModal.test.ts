import { describe, expect, it } from 'vitest';
import { predictionPresentation } from './publicPredictionsPresentation';

describe('public prediction presentation', () => {
  it('maps exact, result, one-team goal and miss to distinct requested tones', () => {
    expect(predictionPresentation.EXACT_SCORE.borderColor).toBe('#34d17b');
    expect(predictionPresentation.RESULT.borderColor).toBe('#72b7f2');
    expect(predictionPresentation.ONE_TEAM_GOALS.borderColor).toBe('#ffa654');
    expect(predictionPresentation.MISS.borderColor).toBe('#ff8878');
    expect(
      new Set(Object.values(predictionPresentation).map((item) => item.borderColor)).size,
    ).toBe(4);
  });
});
