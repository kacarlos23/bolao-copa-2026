import { describe, expect, it } from 'vitest';
import { isPoolMatchScoreable } from '../predictions/scoreability.js';
import { ConmebolProvider } from '../providers/adapters/snapshot-competition.provider.js';
import {
  assertSudamericana2026Readiness,
  sudamericana2026PredictionPolicy,
  SUDAMERICANA_2026_FIXTURE,
  SUDAMERICANA_2026_SCOREABLE_FROM,
} from './sudamericana-2026.service.js';

async function officialFixture() {
  const provider = new ConmebolProvider({
    fixtureName: SUDAMERICANA_2026_FIXTURE,
    competition: 'conmebol-sudamericana',
  });
  const context = { seasonId: 'test' };
  const [teams, structure, ties, schedule, results, standings, evidence] = await Promise.all([
    provider.syncTeams(context),
    provider.syncStructure!(context),
    provider.syncTies!(context),
    provider.syncSchedule(context),
    provider.syncResults(context),
    provider.syncStandings!(context),
    provider.snapshotEvidence!(),
  ]);
  return { teams, structure, ties, schedule, results, standings, evidence };
}

describe('CONMEBOL Sul-Americana 2026', () => {
  it('reconciles groups, historical phases, playoffs and defers unknown future ties', async () => {
    const fixture = await officialFixture();
    const readiness = assertSudamericana2026Readiness(fixture);
    const groupNames = new Set(fixture.standings.map((standing) => standing.groupName));
    const playoffTies = fixture.ties.filter((tie) => tie.roundExternalId === 'round:playoffs');

    expect(readiness).toMatchObject({
      teams: 56,
      stages: 3,
      groupRounds: 6,
      ties: 24,
      scheduledMatches: 128,
      historicalResults: 114,
      standings: 32,
      libertadoresTransfers: 8,
      excludedTbcPlaceholders: 16,
    });
    expect(groupNames).toEqual(new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']));
    expect(playoffTies).toHaveLength(8);
    expect(fixture.ties.filter((tie) => tie.decisionMethod === 'PENALTIES')).toHaveLength(6);
    expect(fixture.results.filter((result) => result.penaltyHomeScore !== undefined)).toHaveLength(
      6,
    );
    expect(
      fixture.teams.filter(
        (team) => team.providerMetadata?.entryRoute === 'LIBERTADORES_GROUP_THIRD',
      ),
    ).toHaveLength(8);
    expect(fixture.schedule.some((match) => match.homeTeamName === 'Unknown')).toBe(false);
    expect(
      fixture.ties.some((tie) =>
        ['round:round-of-16', 'round:quarterfinals', 'round:semifinals', 'round:final'].includes(
          tie.roundExternalId,
        ),
      ),
    ).toBe(false);
  });

  it('never scores history and opens only at the official future cutoff', () => {
    const policy = sudamericana2026PredictionPolicy();
    expect(policy).toEqual({
      scoreableFromRound: null,
      scoreableFrom: SUDAMERICANA_2026_SCOREABLE_FROM,
      startsAtRound: null,
      historicalMatchesScoreable: false,
    });
    expect(
      isPoolMatchScoreable(policy, {
        startsAt: new Date('2026-07-30T00:30:00.000Z'),
        roundOrder: 1,
      }),
    ).toBe(false);
    expect(
      isPoolMatchScoreable(policy, {
        startsAt: new Date('2026-08-12T12:00:00.000Z'),
        roundOrder: 2,
      }),
    ).toBe(true);
  });
});
