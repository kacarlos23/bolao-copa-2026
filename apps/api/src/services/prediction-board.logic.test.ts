import { describe, expect, it } from 'vitest';
import { knockoutFixtureSeeds } from '../data/knockout-fixtures.js';
import { thirdPlaceMatrix, thirdPlaceMatrixColumns } from '../data/third-place-matrix.js';
import {
  buildPartialRoundOf32Participants,
  materializeBracket,
  matrixCombinationKeys,
  projectGroupStandings,
  thirdPlaceAssignments,
} from './prediction-board.logic.js';

function qualification(group: string, isResolved: boolean) {
  return {
    group,
    isResolved,
    rows: [1, 2, 3, 4].map((rank) => ({
      rank,
      team: {
        id: `${rank}${group}`,
        name: `${rank}${group}`,
        code: `${rank}${group}`,
        fifaRank: rank,
      },
      played: 3,
      wins: 3 - rank,
      draws: 0,
      losses: rank - 1,
      goalsFor: 5 - rank,
      goalsAgainst: rank - 1,
      goalDifference: 6 - rank * 2,
      points: 10 - rank,
    })),
  };
}

describe('third-place allocation matrix', () => {
  it('contains all 495 unique combinations from Annex C', () => {
    expect(thirdPlaceMatrix).toHaveLength(495);
    expect(new Set(matrixCombinationKeys())).toHaveProperty('size', 495);
  });

  it('maps every combination to eligible opponents without repetition', () => {
    const eligible: Record<string, string> = {
      A: 'CEFHI',
      B: 'EFGIJ',
      D: 'BEFIJ',
      E: 'ABCDF',
      G: 'AEHIJ',
      I: 'CDFGH',
      K: 'DEIJL',
      L: 'EHIJK',
    };

    for (const row of thirdPlaceMatrix) {
      const assignments = thirdPlaceAssignments([...row]);
      expect(new Set(Object.values(assignments))).toHaveProperty('size', 8);
      for (const winnerGroup of thirdPlaceMatrixColumns) {
        expect(eligible[winnerGroup]).toContain(assignments[winnerGroup]);
        expect(assignments[winnerGroup]).not.toBe(winnerGroup);
      }
    }
  });
});

describe('projected standings', () => {
  it('ignores missing predictions and uses completed results', () => {
    const teams = ['A', 'B', 'C', 'D'].map((id, index) => ({
      id,
      name: id,
      code: id,
      fifaRank: index + 1,
    }));
    const rows = projectGroupStandings(teams, [
      {
        id: '1',
        homeTeamId: 'A',
        awayTeamId: 'B',
        status: 'FINISHED',
        homeScore: 1,
        awayScore: 0,
        finalHomeScore: 2,
        finalAwayScore: 0,
        predictedHomeScore: 0,
        predictedAwayScore: 4,
      },
      {
        id: '2',
        homeTeamId: 'C',
        awayTeamId: 'D',
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
        finalHomeScore: null,
        finalAwayScore: null,
        predictedHomeScore: null,
        predictedAwayScore: null,
      },
    ]);
    expect(rows[0].team.id).toBe('A');
    expect(rows[0].points).toBe(3);
    expect(rows.find((row) => row.team.id === 'C')?.played).toBe(0);
  });
});

describe('partial knockout qualification', () => {
  it('reveals direct qualifiers only after their group projection is resolved', () => {
    const groups = 'ABCDEFGHIJKL'.split('').map((group) =>
      qualification(group, ['A', 'B'].includes(group)),
    );
    const participants = buildPartialRoundOf32Participants(groups);

    expect(participants.get(73)).toEqual({ homeTeamId: '2A', awayTeamId: '2B' });
    expect(participants.get(74)).toEqual({ homeTeamId: null, awayTeamId: null });
    expect(participants.get(79)).toEqual({ homeTeamId: '1A', awayTeamId: null });
  });

  it('fills every first-round slot when all group projections are resolved', () => {
    const groups = 'ABCDEFGHIJKL'.split('').map((group) => qualification(group, true));
    const participants = buildPartialRoundOf32Participants(groups);

    expect(participants).toHaveProperty('size', 16);
    expect([...participants.values()].every((item) => item.homeTeamId && item.awayTeamId)).toBe(true);
  });
});

describe('complete knockout bracket', () => {
  it('materializes all 32 matches and propagates winners and semi-final losers', () => {
    const roundOf32 = new Map(
      knockoutFixtureSeeds
        .filter((fixture) => fixture.stage === 'ROUND_OF_32')
        .map((fixture) => [
          fixture.matchNumber,
          { homeTeamId: `H${fixture.matchNumber}`, awayTeamId: `A${fixture.matchNumber}` },
        ]),
    );
    const advancing = new Map<number, string>();
    const participants = new Map(roundOf32);
    const inputs = knockoutFixtureSeeds.map((fixture) => {
      const seeded = participants.get(fixture.matchNumber);
      const fromSource = (source: string) => {
        const previous = participants.get(Number(source.slice(1)))!;
        const winner = advancing.get(Number(source.slice(1)))!;
        return source.startsWith('W')
          ? winner
          : winner === previous.homeTeamId
            ? previous.awayTeamId
            : previous.homeTeamId;
      };
      const homeTeamId = seeded?.homeTeamId ?? fromSource(fixture.homeSource);
      const awayTeamId = seeded?.awayTeamId ?? fromSource(fixture.awaySource);
      participants.set(fixture.matchNumber, { homeTeamId, awayTeamId });
      advancing.set(fixture.matchNumber, homeTeamId);
      return {
        matchNumber: fixture.matchNumber,
        predictedHomeScore: 1,
        predictedAwayScore: 0,
        advancingTeamId: homeTeamId,
      };
    });

    const result = materializeBracket(inputs, roundOf32);
    expect(result).toHaveLength(32);
    expect(result.find((pick) => pick.matchNumber === 103)?.homeTeamId).toBe(
      participants.get(101)?.awayTeamId,
    );
  });

  it('rejects incomplete submissions', () => {
    expect(() => materializeBracket([], new Map())).toThrow('32 jogos');
  });

  it('materializes partial submissions when partial mode is enabled', () => {
    const fixture = knockoutFixtureSeeds[0];
    const roundOf32 = new Map([
      [fixture.matchNumber, { homeTeamId: 'home-team', awayTeamId: 'away-team' }],
    ]);

    const result = materializeBracket(
      [
        {
          matchNumber: fixture.matchNumber,
          predictedHomeScore: 2,
          predictedAwayScore: 1,
          advancingTeamId: 'home-team',
        },
      ],
      roundOf32,
      knockoutFixtureSeeds,
      { allowPartial: true },
    );

    expect(result).toEqual([
      {
        matchNumber: fixture.matchNumber,
        homeTeamId: 'home-team',
        awayTeamId: 'away-team',
        predictedHomeScore: 2,
        predictedAwayScore: 1,
        advancingTeamId: 'home-team',
      },
    ]);
  });
});
