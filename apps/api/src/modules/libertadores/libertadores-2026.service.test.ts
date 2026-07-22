import { describe, expect, it } from 'vitest';
import { isPoolMatchScoreable } from '../predictions/scoreability.js';
import { ConmebolProvider } from '../providers/adapters/snapshot-competition.provider.js';
import { SUDAMERICANA_2026_FIXTURE } from '../sudamericana/sudamericana-2026.service.js';
import {
  deriveGroupStandings,
  groupStandingDifferences,
} from '../conmebol/standings-reconciliation.js';
import {
  assertGlobalTransferIdentity,
  assertLibertadores2026Readiness,
  libertadores2026PredictionPolicy,
  LIBERTADORES_2026_FIXTURE,
  LIBERTADORES_2026_SCOREABLE_FROM,
} from './libertadores-2026.service.js';

async function providerState(fixtureName: string, competition: string) {
  const provider = new ConmebolProvider({ fixtureName, competition });
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

describe('CONMEBOL Libertadores 2026', () => {
  it('reconciles preliminary history, groups, standings and the official final-stage slots', async () => {
    const fixture = await providerState(LIBERTADORES_2026_FIXTURE, 'conmebol-libertadores');
    const readiness = assertLibertadores2026Readiness(fixture);
    const groupNames = new Set(fixture.standings.map((standing) => standing.groupName));
    const finalRounds = fixture.structure.filter(
      (item) => item.kind === 'ROUND' && item.stageExternalId === 'stage:finals',
    );

    expect(readiness).toMatchObject({
      teams: 47,
      stages: 3,
      preliminaryRounds: 3,
      groupRounds: 6,
      finalRounds: 4,
      ties: 23,
      preliminaryTies: 15,
      roundOf16Ties: 8,
      scheduledMatches: 142,
      historicalResults: 126,
      standings: 32,
      qualified: 16,
      sudamericanaTransfers: 8,
      deferredBracketSlots: 7,
    });
    expect(groupNames).toEqual(new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']));
    expect(finalRounds.map((round) => round.externalId)).toEqual([
      'round:round-of-16',
      'round:quarterfinals',
      'round:semifinals',
      'round:final',
    ]);
    expect(fixture.ties.filter((tie) => tie.roundExternalId === 'round:round-of-16')).toHaveLength(
      8,
    );
    expect(
      fixture.ties.some((tie) =>
        ['round:quarterfinals', 'round:semifinals', 'round:final'].includes(tie.roundExternalId),
      ),
    ).toBe(false);
    expect(
      finalRounds
        .filter((round) => round.externalId !== 'round:round-of-16')
        .every(
          (round) =>
            round.metadata?.concreteTiesDeferred === true ||
            round.metadata?.concreteTieDeferred === true,
        ),
    ).toBe(true);
  });

  it('derives the official table and detects a corrected historical score', async () => {
    const fixture = await providerState(LIBERTADORES_2026_FIXTURE, 'conmebol-libertadores');
    const groupMatchIds = new Set(
      fixture.schedule
        .filter((match) => match.stageExternalId === 'stage:groups')
        .map((match) => match.externalId),
    );
    const groupResults = fixture.results.filter(
      (result) => result.matchExternalId && groupMatchIds.has(result.matchExternalId),
    );

    expect(deriveGroupStandings(groupResults).size).toBe(32);
    expect(groupStandingDifferences(groupResults, fixture.standings)).toEqual([]);
    const corrected = groupResults.map((result, index) =>
      index === 0 ? { ...result, homeScore: result.homeScore + 1 } : result,
    );
    expect(groupStandingDifferences(corrected, fixture.standings).length).toBeGreaterThan(0);
    expect(groupStandingDifferences(groupResults, fixture.standings)).toEqual([]);
  });

  it('keeps every decided preliminary qualifier consistent with aggregate or penalties', async () => {
    const fixture = await providerState(LIBERTADORES_2026_FIXTURE, 'conmebol-libertadores');
    const results = new Map(fixture.results.map((result) => [result.matchExternalId, result]));
    for (const tie of fixture.ties.filter(
      (entry) => entry.status === 'DECIDED' && entry.stageExternalId === 'stage:preliminary',
    )) {
      const teamAExternalId = tie.teamAExternalId!;
      const teamBExternalId = tie.teamBExternalId!;
      const legs = fixture.schedule
        .filter((match) => match.tieExternalId === tie.externalId)
        .sort(
          (left, right) =>
            new Date(left.startsAt!).getTime() - new Date(right.startsAt!).getTime(),
        );
      const totals = new Map<string, number>([
        [teamAExternalId, 0],
        [teamBExternalId, 0],
      ]);
      for (const leg of legs) {
        const result = results.get(leg.externalId)!;
        totals.set(
          leg.homeTeamExternalId!,
          totals.get(leg.homeTeamExternalId!)! + result.homeScore,
        );
        totals.set(
          leg.awayTeamExternalId!,
          totals.get(leg.awayTeamExternalId!)! + result.awayScore,
        );
      }
      const decidingLeg = legs.at(-1)!;
      const decidingResult = results.get(decidingLeg.externalId)!;
      const expectedWinner =
        decidingResult.penaltyHomeScore != null && decidingResult.penaltyAwayScore != null
          ? decidingResult.penaltyHomeScore > decidingResult.penaltyAwayScore
            ? decidingLeg.homeTeamExternalId
            : decidingLeg.awayTeamExternalId
          : totals.get(teamAExternalId)! > totals.get(teamBExternalId)!
            ? teamAExternalId
            : teamBExternalId;
      expect(tie.winnerTeamExternalId, tie.externalId).toBe(expectedWinner);
    }
  });

  it('links each exported third-place club through the same global Team identity', async () => {
    const libertadores = await providerState(LIBERTADORES_2026_FIXTURE, 'conmebol-libertadores');
    const sudamericana = await providerState(SUDAMERICANA_2026_FIXTURE, 'conmebol-sudamericana');
    const transferredExternalIds = libertadores.standings
      .filter((standing) => standing.qualification === 'TRANSFERRED')
      .map((standing) => standing.teamExternalId!);
    const sudamericanaTransfers = new Set(
      sudamericana.teams
        .filter((team) => team.providerMetadata?.entryRoute === 'LIBERTADORES_GROUP_THIRD')
        .map((team) => team.externalId),
    );
    expect(new Set(transferredExternalIds)).toEqual(sudamericanaTransfers);

    const mappings = transferredExternalIds.flatMap((rawExternalId, index) => [
      { seasonId: 'libertadores', rawExternalId, internalId: `team-${index}` },
      { seasonId: 'sudamericana', rawExternalId, internalId: `team-${index}` },
    ]);
    expect(
      assertGlobalTransferIdentity({
        sourceSeasonId: 'libertadores',
        targetSeasonId: 'sudamericana',
        transferredExternalIds,
        mappings,
      }),
    ).toHaveLength(8);
    expect(() =>
      assertGlobalTransferIdentity({
        sourceSeasonId: 'libertadores',
        targetSeasonId: 'sudamericana',
        transferredExternalIds,
        mappings: mappings.map((mapping, index) =>
          index === 1 ? { ...mapping, internalId: 'duplicated-club' } : mapping,
        ),
      }),
    ).toThrow(/identidade Team global única/);
  });

  it('keeps match and tie namespaces isolated from Sudamericana', async () => {
    const [libertadores, sudamericana] = await Promise.all([
      providerState(LIBERTADORES_2026_FIXTURE, 'conmebol-libertadores'),
      providerState(SUDAMERICANA_2026_FIXTURE, 'conmebol-sudamericana'),
    ]);
    const sudamericanaMatchIds = new Set(sudamericana.schedule.map((match) => match.externalId));
    const sudamericanaTieIds = new Set(sudamericana.ties.map((tie) => tie.externalId));
    expect(libertadores.schedule.some((match) => sudamericanaMatchIds.has(match.externalId))).toBe(
      false,
    );
    expect(libertadores.ties.some((tie) => sudamericanaTieIds.has(tie.externalId))).toBe(false);
    expect(libertadores.evidence.competition).toBe('conmebol-libertadores');
    expect(sudamericana.evidence.competition).toBe('conmebol-sudamericana');
  });

  it('never scores history and opens only at the first fully confirmed round-of-16 match', () => {
    const policy = libertadores2026PredictionPolicy();
    expect(policy).toEqual({
      scoreableFromRound: null,
      scoreableFrom: LIBERTADORES_2026_SCOREABLE_FROM,
      startsAtRound: null,
      historicalMatchesScoreable: false,
    });
    expect(
      isPoolMatchScoreable(policy, {
        startsAt: new Date('2026-05-29T00:30:00.000Z'),
        roundOrder: 6,
      }),
    ).toBe(false);
    expect(
      isPoolMatchScoreable(policy, {
        startsAt: new Date('2026-08-11T22:00:00.000Z'),
        roundOrder: 1,
      }),
    ).toBe(true);
  });
});
