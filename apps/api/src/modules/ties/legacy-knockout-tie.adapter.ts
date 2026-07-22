import type { MatchStatus, TieDecisionMethod, TieStatus } from '@prisma/client';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';

export const LEGACY_KNOCKOUT_TIE_PROVIDER = 'legacy-knockout-fixture';

export function legacyKnockoutTieExternalId(fixtureId: string) {
  return `knockout-fixture:${fixtureId}`;
}

export interface LegacyKnockoutFixtureShadow {
  id: string;
  seasonId: string | null;
  status: MatchStatus;
  homeTeamId: string | null;
  awayTeamId: string | null;
  winnerTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
}

export interface GenericTieShadow {
  id: string;
  seasonId: string;
  expectedLegs: number;
  status: TieStatus;
  decisionMethod: TieDecisionMethod | null;
  teamAId: string;
  teamBId: string;
  winnerTeamId: string | null;
  aggregateTeamAScore: number | null;
  aggregateTeamBScore: number | null;
}

export type TieShadowParity = 'match' | 'mismatch' | 'missing';

export interface TieShadowParityMetric {
  name: 'knockout_tie_shadow_parity_total';
  value: 1;
  outcome: TieShadowParity;
  legacyFixtureId: string;
  tieId: string | null;
}

export type TieShadowMetricEmitter = (metric: TieShadowParityMetric) => void;

function defaultMetricEmitter(metric: TieShadowParityMetric) {
  const message = 'KnockoutFixture/Tie shadow read parity';
  if (metric.outcome === 'match') logger.info({ metric }, message);
  else logger.error({ metric }, message);
}

function scoreByTeam(
  firstTeamId: string | null,
  secondTeamId: string | null,
  firstScore: number | null,
  secondScore: number | null,
) {
  if (!firstTeamId || !secondTeamId || firstScore == null || secondScore == null) return null;
  const scores: Array<[string, number]> = [
    [firstTeamId, firstScore],
    [secondTeamId, secondScore],
  ];
  return Object.fromEntries(scores.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizedLegacy(fixture: LegacyKnockoutFixtureShadow) {
  const homeScore = fixture.finalHomeScore ?? fixture.homeScore;
  const awayScore = fixture.finalAwayScore ?? fixture.awayScore;
  return {
    seasonId: fixture.seasonId,
    expectedLegs: 1,
    participantIds: [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean).sort(),
    winnerTeamId: fixture.winnerTeamId,
    isDecided: fixture.status === 'FINISHED' && fixture.winnerTeamId != null,
    scoreByTeam: scoreByTeam(fixture.homeTeamId, fixture.awayTeamId, homeScore, awayScore),
  };
}

function normalizedTie(tie: GenericTieShadow) {
  return {
    seasonId: tie.seasonId,
    expectedLegs: tie.expectedLegs,
    participantIds: [tie.teamAId, tie.teamBId].sort(),
    winnerTeamId: tie.winnerTeamId,
    isDecided: tie.status === 'DECIDED' && tie.decisionMethod != null,
    scoreByTeam: scoreByTeam(
      tie.teamAId,
      tie.teamBId,
      tie.aggregateTeamAScore,
      tie.aggregateTeamBScore,
    ),
  };
}

export function legacyTieShadowParity(
  fixture: LegacyKnockoutFixtureShadow,
  tie: GenericTieShadow | null,
): TieShadowParity {
  if (!tie) return 'missing';
  return JSON.stringify(normalizedLegacy(fixture)) === JSON.stringify(normalizedTie(tie))
    ? 'match'
    : 'mismatch';
}

export function shadowReadLegacyKnockoutFixture<T extends LegacyKnockoutFixtureShadow>(
  fixture: T,
  tie: GenericTieShadow | null,
  emitMetric: TieShadowMetricEmitter = defaultMetricEmitter,
): T {
  emitMetric({
    name: 'knockout_tie_shadow_parity_total',
    value: 1,
    outcome: legacyTieShadowParity(fixture, tie),
    legacyFixtureId: fixture.id,
    tieId: tie?.id ?? null,
  });
  return fixture;
}

export function assertLegacyTieShadowParity(
  fixture: LegacyKnockoutFixtureShadow,
  tie: GenericTieShadow | null,
) {
  const parity = legacyTieShadowParity(fixture, tie);
  if (parity !== 'match') {
    throw new Error(`KnockoutFixture/Tie parity gate failed for ${fixture.id}: ${parity}`);
  }
}

export async function observeLegacyKnockoutTieShadows<T extends LegacyKnockoutFixtureShadow>(
  fixtures: readonly T[],
): Promise<T[]> {
  if (!fixtures.length) return [];
  const byExternalId = new Map(
    fixtures.map((fixture) => [legacyKnockoutTieExternalId(fixture.id), fixture]),
  );
  const mappings = await prisma.providerEntityMapping.findMany({
    where: {
      provider: LEGACY_KNOCKOUT_TIE_PROVIDER,
      entityType: 'TIE',
      externalId: { in: [...byExternalId.keys()] },
    },
    select: { externalId: true, internalId: true },
  });
  if (!mappings.length) return [...fixtures];

  const ties = await prisma.tie.findMany({
    where: { id: { in: mappings.map((mapping) => mapping.internalId) } },
    select: {
      id: true,
      seasonId: true,
      expectedLegs: true,
      status: true,
      decisionMethod: true,
      teamAId: true,
      teamBId: true,
      winnerTeamId: true,
      aggregateTeamAScore: true,
      aggregateTeamBScore: true,
    },
  });
  const tieById = new Map(ties.map((tie) => [tie.id, tie]));
  const mappingByExternalId = new Map(mappings.map((mapping) => [mapping.externalId, mapping]));

  return fixtures.map((fixture) => {
    const mapping = mappingByExternalId.get(legacyKnockoutTieExternalId(fixture.id));
    return mapping
      ? shadowReadLegacyKnockoutFixture(fixture, tieById.get(mapping.internalId) ?? null)
      : fixture;
  });
}
