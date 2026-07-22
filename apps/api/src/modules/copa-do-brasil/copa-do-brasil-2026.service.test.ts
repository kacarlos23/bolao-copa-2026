import { describe, expect, it } from 'vitest';
import { isPoolMatchScoreable } from '../predictions/scoreability.js';
import { CbfCopaDoBrasilProvider } from '../providers/adapters/cbf-copa-do-brasil-2026.provider.js';
import {
  assertCopaDoBrasil2026Readiness,
  copaDoBrasil2026PredictionPolicy,
  COPA_DO_BRASIL_2026_FIXTURE,
  COPA_DO_BRASIL_2026_SCOREABLE_FROM,
} from './copa-do-brasil-2026.service.js';

async function providerState() {
  const provider = new CbfCopaDoBrasilProvider({ fixtureName: COPA_DO_BRASIL_2026_FIXTURE });
  const context = { seasonId: 'test' };
  const [teams, structure, ties, schedule, results, standings, evidence] = await Promise.all([
    provider.syncTeams(context),
    provider.syncStructure(context),
    provider.syncTies(context),
    provider.syncSchedule(context),
    provider.syncResults(context),
    provider.syncStandings(context),
    provider.snapshotEvidence(),
  ]);
  return { teams, structure, ties, schedule, results, standings, evidence };
}

describe('Copa do Brasil 2026', () => {
  it('reconcilia as nove fases, 126 clubes e entradas tardias', async () => {
    const fixture = await providerState();
    const readiness = assertCopaDoBrasil2026Readiness(fixture);
    expect(readiness).toMatchObject({
      teams: 126,
      stages: 1,
      rounds: 9,
      ties: 118,
      scheduledMatches: 142,
      historicalResults: 126,
      standings: 0,
      decidedTies: 110,
      scheduledTies: 8,
      entryPhaseCounts: { '1': 28, '2': 74, '3': 4, '4': 0, '5': 20 },
      deferredBracketSlots: 7,
    });
    const rounds = fixture.structure.filter((item) => item.kind === 'ROUND');
    expect(rounds).toHaveLength(9);
    expect(rounds.map((round) => round.metadata?.expectedLegs)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 1,
    ]);
    expect(rounds.at(-1)).toMatchObject({
      name: 'Final',
      metadata: {
        deferredTieSlots: 1,
        expectedLegs: 1,
        groups: 1,
        tieBreak: 'PENALTIES',
        mandoRule: 'CBF defines the final venue and home designation.',
      },
    });
    expect(fixture.teams.filter((team) => team.providerMetadata?.entryPhase === 5)).toHaveLength(
      20,
    );
  });

  it('representa jogo único, ida e volta, inversão de mando e pênaltis', async () => {
    const fixture = await providerState();
    expect(fixture.ties.filter((tie) => tie.expectedLegs === 1)).toHaveLength(94);
    expect(fixture.ties.filter((tie) => tie.expectedLegs === 2)).toHaveLength(24);
    expect(fixture.results.filter((result) => result.penaltyHomeScore !== undefined)).toHaveLength(
      33,
    );
    const twoLegTie = fixture.ties.find((tie) => tie.expectedLegs === 2)!;
    const legs = fixture.schedule
      .filter((match) => match.tieExternalId === twoLegTie.externalId)
      .sort((left, right) => left.legNumber! - right.legNumber!);
    expect(legs).toHaveLength(2);
    expect(legs[1]).toMatchObject({
      homeTeamExternalId: legs[0].awayTeamExternalId,
      awayTeamExternalId: legs[0].homeTeamExternalId,
      externalId: expect.stringContaining('match:cbf-copa-do-brasil:2026:'),
    });
    const penaltyResult = fixture.results.find((result) => result.penaltyHomeScore !== undefined)!;
    const penaltyTie = fixture.ties.find((tie) =>
      fixture.schedule.some(
        (match) =>
          match.tieExternalId === tie.externalId &&
          match.externalId === penaltyResult.matchExternalId,
      ),
    )!;
    expect(penaltyTie.status).toBe('DECIDED');
    expect(penaltyTie.decisionMethod).toBe('PENALTIES');
    expect(penaltyTie.winnerTeamExternalId).toBeTruthy();
  });

  it('mantém histórico fora da pontuação e IDs estáveis para correções oficiais', async () => {
    const fixture = await providerState();
    const policy = copaDoBrasil2026PredictionPolicy();
    expect(policy).toEqual({
      scoreableFromRound: 6,
      scoreableFrom: COPA_DO_BRASIL_2026_SCOREABLE_FROM,
      startsAtRound: 6,
      historicalMatchesScoreable: false,
    });
    expect(
      isPoolMatchScoreable(policy, {
        startsAt: new Date('2026-04-30T00:00:00.000Z'),
        roundOrder: 5,
      }),
    ).toBe(false);
    expect(
      isPoolMatchScoreable(policy, {
        startsAt: COPA_DO_BRASIL_2026_SCOREABLE_FROM,
        roundOrder: 6,
      }),
    ).toBe(true);
    expect(new Set(fixture.schedule.map((match) => match.externalId)).size).toBe(142);
    expect(new Set(fixture.ties.map((tie) => tie.externalId)).size).toBe(118);
    expect(fixture.results.every((result) => result.status === 'FINISHED')).toBe(true);
  });
});
