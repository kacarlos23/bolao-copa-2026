import { MatchStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { shouldIgnoreScoreRegression, statusAllowedByKickoff } from './score-sync.logic.js';

describe('score synchronization status', () => {
  it('does not allow a finished match to return to live', () => {
    expect(shouldIgnoreScoreRegression(MatchStatus.FINISHED, MatchStatus.LIVE)).toBe(true);
  });

  it('accepts a final correction for an already finished match', () => {
    expect(shouldIgnoreScoreRegression(MatchStatus.FINISHED, MatchStatus.FINISHED)).toBe(false);
  });
});

describe('score synchronization kickoff guard', () => {
  it('does not mark a future match as live during GE pre-game coverage', () => {
    expect(
      statusAllowedByKickoff(
        MatchStatus.LIVE,
        new Date('2026-06-14T20:00:00.000Z'),
        new Date('2026-06-14T18:20:00.000Z'),
      ),
    ).toBe(MatchStatus.SCHEDULED);
  });

  it('accepts live status after kickoff', () => {
    expect(
      statusAllowedByKickoff(
        MatchStatus.LIVE,
        new Date('2026-06-14T20:00:00.000Z'),
        new Date('2026-06-14T20:01:00.000Z'),
      ),
    ).toBe(MatchStatus.LIVE);
  });
});
