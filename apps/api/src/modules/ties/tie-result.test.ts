import { describe, expect, it } from 'vitest';
import { computeTieResult, type TieLegResultInput } from './tie-result.js';

function leg(overrides: Partial<TieLegResultInput> = {}): TieLegResultInput {
  return {
    matchId: 'match-1',
    legNumber: 1,
    status: 'FINISHED',
    homeTeamId: 'team-a',
    awayTeamId: 'team-b',
    regulationHomeScore: 2,
    regulationAwayScore: 1,
    extraTimeHomeScore: null,
    extraTimeAwayScore: null,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    ...overrides,
  };
}

describe('computeTieResult', () => {
  it('decides a one-match series by its regulation aggregate', () => {
    expect(
      computeTieResult({
        teamAId: 'team-a',
        teamBId: 'team-b',
        expectedLegs: 1,
        legs: [leg()],
      }),
    ).toEqual({
      status: 'DECIDED',
      decisionMethod: 'AGGREGATE',
      winnerTeamId: 'team-a',
      aggregateTeamAScore: 2,
      aggregateTeamBScore: 1,
      completedLegs: 1,
      reason: 'DECIDED',
    });
  });

  it('sums two legs by team identity even when home advantage is reversed', () => {
    const result = computeTieResult({
      teamAId: 'team-a',
      teamBId: 'team-b',
      expectedLegs: 2,
      legs: [
        leg({ regulationHomeScore: 1, regulationAwayScore: 0 }),
        leg({
          matchId: 'match-2',
          legNumber: 2,
          homeTeamId: 'team-b',
          awayTeamId: 'team-a',
          regulationHomeScore: 1,
          regulationAwayScore: 2,
        }),
      ],
    });

    expect(result).toMatchObject({
      status: 'DECIDED',
      decisionMethod: 'AGGREGATE',
      winnerTeamId: 'team-a',
      aggregateTeamAScore: 3,
      aggregateTeamBScore: 1,
    });
  });

  it('keeps penalties outside the aggregate and uses them only to classify', () => {
    const result = computeTieResult({
      teamAId: 'team-a',
      teamBId: 'team-b',
      expectedLegs: 1,
      legs: [
        leg({
          regulationHomeScore: 1,
          regulationAwayScore: 1,
          extraTimeHomeScore: 0,
          extraTimeAwayScore: 0,
          penaltyHomeScore: 4,
          penaltyAwayScore: 3,
        }),
      ],
    });

    expect(result).toMatchObject({
      status: 'DECIDED',
      decisionMethod: 'PENALTIES',
      winnerTeamId: 'team-a',
      aggregateTeamAScore: 1,
      aggregateTeamBScore: 1,
    });
  });

  it('identifies extra time when it breaks a regulation aggregate tie', () => {
    expect(
      computeTieResult({
        teamAId: 'team-a',
        teamBId: 'team-b',
        expectedLegs: 1,
        legs: [
          leg({
            regulationHomeScore: 0,
            regulationAwayScore: 0,
            extraTimeHomeScore: 1,
            extraTimeAwayScore: 0,
          }),
        ],
      }),
    ).toMatchObject({
      decisionMethod: 'EXTRA_TIME',
      winnerTeamId: 'team-a',
      aggregateTeamAScore: 1,
      aggregateTeamBScore: 0,
    });
  });

  it('never infers a winner from an incomplete or unresolved series', () => {
    const incomplete = computeTieResult({
      teamAId: 'team-a',
      teamBId: 'team-b',
      expectedLegs: 2,
      legs: [leg()],
    });
    const unresolved = computeTieResult({
      teamAId: 'team-a',
      teamBId: 'team-b',
      expectedLegs: 1,
      legs: [leg({ regulationHomeScore: 0, regulationAwayScore: 0 })],
    });

    expect(incomplete).toMatchObject({
      status: 'IN_PROGRESS',
      winnerTeamId: null,
      completedLegs: 1,
      reason: 'AWAITING_LEGS',
    });
    expect(unresolved).toMatchObject({
      status: 'IN_PROGRESS',
      winnerTeamId: null,
      decisionMethod: null,
      reason: 'AWAITING_DECISION',
    });
  });

  it('supports explicit W.O. without inventing a score', () => {
    expect(
      computeTieResult({
        teamAId: 'team-a',
        teamBId: 'team-b',
        expectedLegs: 2,
        legs: [],
        declaredDecision: { method: 'WALKOVER', winnerTeamId: 'team-b' },
      }),
    ).toEqual({
      status: 'DECIDED',
      decisionMethod: 'WALKOVER',
      winnerTeamId: 'team-b',
      aggregateTeamAScore: null,
      aggregateTeamBScore: null,
      completedLegs: 0,
      reason: 'DECIDED',
    });
  });

  it('recomputes a corrected series from current scores instead of retaining the old winner', () => {
    const original = computeTieResult({
      teamAId: 'team-a',
      teamBId: 'team-b',
      expectedLegs: 1,
      legs: [leg({ regulationHomeScore: 2, regulationAwayScore: 0 })],
    });
    const corrected = computeTieResult({
      teamAId: 'team-a',
      teamBId: 'team-b',
      expectedLegs: 1,
      legs: [leg({ regulationHomeScore: 0, regulationAwayScore: 1 })],
    });

    expect(original.winnerTeamId).toBe('team-a');
    expect(corrected).toMatchObject({
      winnerTeamId: 'team-b',
      aggregateTeamAScore: 0,
      aggregateTeamBScore: 1,
    });
  });

  it('is deterministic regardless of input leg order', () => {
    const legs = [
      leg({ regulationHomeScore: 1, regulationAwayScore: 0 }),
      leg({
        matchId: 'match-2',
        legNumber: 2,
        homeTeamId: 'team-b',
        awayTeamId: 'team-a',
        regulationHomeScore: 1,
        regulationAwayScore: 0,
        penaltyHomeScore: 3,
        penaltyAwayScore: 4,
      }),
    ];
    const input = {
      teamAId: 'team-a',
      teamBId: 'team-b',
      expectedLegs: 2 as const,
    };
    expect(computeTieResult({ ...input, legs })).toEqual(
      computeTieResult({ ...input, legs: [...legs].reverse() }),
    );
  });
});
