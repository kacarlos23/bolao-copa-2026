import { describe, expect, it } from 'vitest';
import {
  calculateStandings,
  type StandingsMatch,
  type StandingsParticipant,
} from './standings.logic.js';

function participant(id: string): StandingsParticipant {
  return {
    group: 'Série A',
    team: { id, name: id, code: id, flagUrl: null, crestUrl: null },
  };
}

function finished(
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  cards: Partial<StandingsMatch> = {},
): StandingsMatch {
  return {
    group: 'Série A',
    status: 'FINISHED',
    homeTeamId,
    awayTeamId,
    homeScore,
    awayScore,
    ...cards,
  };
}

describe('Brasileirão deterministic standings', () => {
  it('calculates J/V/E/D/GP/GC/SG/PTS and uses the confirmed version', () => {
    const [group] = calculateStandings(
      [participant('A'), participant('B')],
      [finished('A', 'B', 2, 1, { homeYellowCards: 2, awayRedCards: 1 })],
      { ruleSet: 'CBF_SERIE_A_2026' },
    );

    expect(group.rows[0]).toEqual(
      expect.objectContaining({
        played: 1,
        wins: 1,
        draws: 0,
        losses: 0,
        goalsFor: 2,
        goalsAgainst: 1,
        goalDifference: 1,
        points: 3,
        yellowCards: 2,
        tieBreakRuleVersion: 'cbf-rec-2026-art-15-v1',
      }),
    );
  });

  it('uses the direct confrontation only for an otherwise tied pair', () => {
    const [group] = calculateStandings(
      ['A', 'B', 'C', 'D'].map(participant),
      [finished('A', 'B', 1, 0), finished('C', 'A', 1, 0), finished('B', 'D', 1, 0)],
      { ruleSet: 'CBF_SERIE_A_2026' },
    );

    expect(group.rows.map((row) => row.team.id)).toEqual(['C', 'A', 'B', 'D']);
  });

  it('skips head-to-head for three clubs and falls through to fewer cards deterministically', () => {
    const [group] = calculateStandings(
      ['A', 'B', 'C'].map(participant),
      [
        finished('A', 'B', 1, 0, { homeRedCards: 1 }),
        finished('B', 'C', 1, 0, { homeYellowCards: 2 }),
        finished('C', 'A', 1, 0, { awayRedCards: 1 }),
      ],
      { ruleSet: 'CBF_SERIE_A_2026' },
    );

    expect(group.rows.map((row) => row.team.id)).toEqual(['C', 'B', 'A']);
  });
});
