import { describe, expect, it } from 'vitest';
import { matchPredictionsCloseAt, matchPredictionState } from './prediction.service.js';

describe('match prediction deadline', () => {
  it('closes each match exactly 5 minutes before its own start by default', () => {
    const startsAt = new Date('2026-06-14T19:00:00.000Z');

    expect(matchPredictionsCloseAt(startsAt).toISOString()).toBe('2026-06-14T18:55:00.000Z');
  });

  it('allows a prediction at 6 minutes and blocks it at 5 minutes', () => {
    const startsAt = new Date('2026-06-14T19:00:00.000Z');
    expect(
      matchPredictionState(startsAt, new Date('2026-06-14T18:54:00.000Z')).isOpenForPredictions,
    ).toBe(true);
    expect(
      matchPredictionState(startsAt, new Date('2026-06-14T18:55:00.000Z')).isOpenForPredictions,
    ).toBe(false);
  });

  it('keeps a later match open after an earlier match on the same day has closed', () => {
    const now = new Date('2026-06-14T18:56:00.000Z');
    const earlierMatch = matchPredictionState(new Date('2026-06-14T19:00:00.000Z'), now);
    const laterMatch = matchPredictionState(new Date('2026-06-14T22:00:00.000Z'), now);

    expect(earlierMatch.isOpenForPredictions).toBe(false);
    expect(earlierMatch.predictionsArePublic).toBe(true);
    expect(laterMatch.isOpenForPredictions).toBe(true);
    expect(laterMatch.predictionsArePublic).toBe(false);
  });

  it('reopens a future match when the deadline changes from 30 to 5 minutes', () => {
    const startsAt = new Date('2026-06-14T19:00:00.000Z');
    const now = new Date('2026-06-14T18:45:00.000Z');
    const before = matchPredictionState(startsAt, now, 30);
    const after = matchPredictionState(startsAt, now, 5);

    expect(before.isOpenForPredictions).toBe(false);
    expect(before.predictionsArePublic).toBe(true);
    expect(after.isOpenForPredictions).toBe(true);
    expect(after.predictionsArePublic).toBe(false);
  });

  it('closes a future match immediately when the deadline changes from 5 to 30 minutes', () => {
    const startsAt = new Date('2026-06-14T19:00:00.000Z');
    const now = new Date('2026-06-14T18:45:00.000Z');

    expect(matchPredictionState(startsAt, now, 5).isOpenForPredictions).toBe(true);
    expect(matchPredictionState(startsAt, now, 30).isOpenForPredictions).toBe(false);
  });

  it('never reopens a match that has already started', () => {
    const startsAt = new Date('2026-06-14T19:00:00.000Z');
    const now = new Date('2026-06-14T19:01:00.000Z');

    expect(matchPredictionState(startsAt, now, 1).isOpenForPredictions).toBe(false);
    expect(matchPredictionState(startsAt, now, 1).predictionsArePublic).toBe(true);
  });
});
