import { describe, expect, it } from 'vitest';
import {
  buildAwardWinner,
  compareRankingRows,
  rankingSnapshotRetentionCutoff,
  type RankingAwardScoreInput,
  type RankingRowBase,
} from './ranking.service.js';

function rankingRow(input: Partial<RankingRowBase> & { nickname: string }): RankingRowBase {
  return {
    points: 0,
    exactScores: 0,
    resultHits: 0,
    oneGoalHits: 0,
    misses: 0,
    ...input,
  };
}

function awardScore(input: Partial<RankingAwardScoreInput> & { userId: string; nickname: string }) {
  return {
    avatarUrl: null,
    points: 0,
    isFinal: true,
    scoreType: 'MISS',
    ...input,
  } satisfies RankingAwardScoreInput;
}

describe('ranking tie-breaks', () => {
  it('orders by points first', () => {
    const rows = [
      rankingRow({ nickname: 'Ana', points: 8 }),
      rankingRow({ nickname: 'Bia', points: 12 }),
    ];

    expect(rows.sort(compareRankingRows)[0].nickname).toBe('Bia');
  });

  it('orders tied points by exact scores, result hits and one-team-goal hits', () => {
    expect(
      [
        rankingRow({ nickname: 'Ana', points: 10, exactScores: 1 }),
        rankingRow({ nickname: 'Bia', points: 10, exactScores: 2 }),
      ].sort(compareRankingRows)[0].nickname,
    ).toBe('Bia');

    expect(
      [
        rankingRow({ nickname: 'Ana', points: 10, exactScores: 2, resultHits: 1 }),
        rankingRow({ nickname: 'Bia', points: 10, exactScores: 2, resultHits: 3 }),
      ].sort(compareRankingRows)[0].nickname,
    ).toBe('Bia');

    expect(
      [
        rankingRow({
          nickname: 'Ana',
          points: 10,
          exactScores: 2,
          resultHits: 3,
          oneGoalHits: 1,
        }),
        rankingRow({
          nickname: 'Bia',
          points: 10,
          exactScores: 2,
          resultHits: 3,
          oneGoalHits: 2,
        }),
      ].sort(compareRankingRows)[0].nickname,
    ).toBe('Bia');
  });

  it('orders remaining ties by fewer misses and keeps complete ties shared', () => {
    expect(
      [
        rankingRow({ nickname: 'Ana', points: 10, misses: 2 }),
        rankingRow({ nickname: 'Bia', points: 10, misses: 1 }),
      ].sort(compareRankingRows)[0].nickname,
    ).toBe('Bia');

    expect(
      compareRankingRows(
        rankingRow({ nickname: 'Carlos', points: 10, misses: 1 }),
        rankingRow({ nickname: 'Ana', points: 10, misses: 1 }),
      ),
    ).toBe(0);
  });
});

describe('ranking snapshot retention', () => {
  it('keeps a deterministic rolling 90-day window', () => {
    expect(rankingSnapshotRetentionCutoff(new Date('2026-07-14T12:00:00.000Z')).toISOString()).toBe(
      '2026-04-15T12:00:00.000Z',
    );
  });
});

describe('award winners', () => {
  it('aggregates scoped scores before choosing the winner', () => {
    const winner = buildAwardWinner([
      awardScore({ userId: 'u1', nickname: 'Ana', points: 5, scoreType: 'RESULT' }),
      awardScore({ userId: 'u1', nickname: 'Ana', points: 5, scoreType: 'ONE_TEAM_GOALS' }),
      awardScore({ userId: 'u2', nickname: 'Bia', points: 9, scoreType: 'EXACT_SCORE' }),
    ]);

    expect(winner).toMatchObject({
      userId: 'u1',
      nickname: 'Ana',
      points: 10,
      resultHits: 1,
      oneGoalHits: 1,
    });
  });

  it('uses goals and fewer misses as scoped award tie-breaks', () => {
    expect(
      buildAwardWinner([
        awardScore({ userId: 'u1', nickname: 'Ana', points: 10, scoreType: 'RESULT' }),
        awardScore({ userId: 'u1', nickname: 'Ana', points: 0, scoreType: 'ONE_TEAM_GOALS' }),
        awardScore({ userId: 'u2', nickname: 'Bia', points: 10, scoreType: 'RESULT' }),
        awardScore({ userId: 'u2', nickname: 'Bia', points: 0, scoreType: 'MISS' }),
      ])?.nickname,
    ).toBe('Ana');

    expect(
      buildAwardWinner([
        awardScore({ userId: 'u1', nickname: 'Ana', points: 10, scoreType: 'MISS' }),
        awardScore({ userId: 'u2', nickname: 'Bia', points: 10, scoreType: 'RESULT' }),
      ])?.nickname,
    ).toBe('Bia');

  });
});
