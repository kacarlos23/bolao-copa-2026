import { Prisma, type ProviderSyncMode, type ProviderSyncType } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { getCompetitionFeatureFlags } from '../competitions/competition-feature.service.js';
import {
  CbfCopaDoBrasilProvider,
  type CbfCopaDoBrasilProviderOptions,
} from '../providers/adapters/cbf-copa-do-brasil-2026.provider.js';
import type { ProviderSnapshotEvidence } from '../providers/competition-data-provider.js';
import { runProviderSync, type ProviderSyncSummary } from '../providers/provider-sync.service.js';
import {
  assertCopaDoBrasil2026Readiness,
  COPA_DO_BRASIL_2026_SCOREABLE_FROM,
  COPA_DO_BRASIL_2026_SEASON_SLUG,
} from './copa-do-brasil-2026.service.js';

export const COPA_DO_BRASIL_SYNC_TYPES: readonly ProviderSyncType[] = [
  'TEAMS',
  'STRUCTURE',
  'TIES',
  'SCHEDULE',
  'RESULTS',
];

export function createCopaDoBrasilProvider(options?: CbfCopaDoBrasilProviderOptions) {
  return new CbfCopaDoBrasilProvider(options);
}

export async function readCopaDoBrasilSource(provider: CbfCopaDoBrasilProvider) {
  const [teams, structure, ties, schedule, results, evidence] = await Promise.all([
    provider.syncTeams({ seasonId: 'source-reconciliation-only' }),
    provider.syncStructure({ seasonId: 'source-reconciliation-only' }),
    provider.syncTies({ seasonId: 'source-reconciliation-only' }),
    provider.syncSchedule({ seasonId: 'source-reconciliation-only' }),
    provider.syncResults({ seasonId: 'source-reconciliation-only' }),
    provider.snapshotEvidence(),
  ]);
  const standings: never[] = [];
  const readiness = assertCopaDoBrasil2026Readiness({
    teams,
    structure,
    ties,
    schedule,
    results,
    standings,
    evidence,
  });
  return { teams, structure, ties, schedule, results, standings, evidence, readiness };
}

export async function synchronizeCopaDoBrasil(
  provider: CbfCopaDoBrasilProvider,
  seasonId: string,
  evidence: ProviderSnapshotEvidence,
  mode: ProviderSyncMode,
) {
  const prefix = `copa-do-brasil-2026:${evidence.checksum.slice(0, 16)}`;
  const runs: ProviderSyncSummary[] = [];
  for (const type of COPA_DO_BRASIL_SYNC_TYPES) {
    const run = await runProviderSync(provider, {
      seasonId,
      type,
      mode,
      idempotencyKey: `${prefix}:${type.toLowerCase()}:${mode.toLowerCase()}`,
    });
    runs.push(run);
  }
  if (runs.some((run) => run.counts.quarantined !== 0)) {
    throw new Error(`Copa do Brasil reconciliation quarantined data: ${JSON.stringify(runs)}`);
  }
  if (
    mode === 'VERIFY' &&
    runs.some((run) => run.counts.inserted !== 0 || run.counts.updated !== 0)
  ) {
    throw new Error(`Copa do Brasil import is not idempotent: ${JSON.stringify(runs)}`);
  }
  return runs;
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

export function hasCopaDoBrasilCapabilities(value: Prisma.JsonValue | null | undefined) {
  const capabilities = jsonObject(value);
  return (
    capabilities.format === 'KNOCKOUT' &&
    capabilities.knockout === true &&
    capabilities.twoLegs === true &&
    capabilities.liveScoring === true &&
    capabilities.standings === false &&
    JSON.stringify(capabilities.rankingScopes) ===
      JSON.stringify(['OVERALL', 'STAGE', 'ROUND'])
  );
}

export async function copaDoBrasilAdministrativeSmoke(seasonId: string) {
  const [
    season,
    flags,
    scores,
    historicalScores,
    providerConfig,
    quarantines,
    tiesByStatus,
    tiesByLegs,
    seasonTeams,
  ] = await Promise.all([
    prisma.competitionSeason.findUniqueOrThrow({
      where: { id: seasonId },
      select: {
        slug: true,
        status: true,
        timezone: true,
        capabilities: true,
        _count: { select: { teams: true, stages: true, rounds: true, ties: true, matches: true } },
        poolSeasons: {
          select: {
            id: true,
            scoreableFrom: true,
            scoreableFromRound: true,
            startsAtRound: true,
            historicalMatchesScoreable: true,
            scoringRuleSet: { select: { key: true, version: true, rules: true } },
          },
        },
      },
    }),
    getCompetitionFeatureFlags(seasonId),
    prisma.predictionScore.count({ where: { match: { seasonId } } }),
    prisma.predictionScore.count({
      where: { match: { seasonId, startsAt: { lt: COPA_DO_BRASIL_2026_SCOREABLE_FROM } } },
    }),
    prisma.seasonProviderConfig.findUniqueOrThrow({
      where: {
        seasonId_providerKey: {
          seasonId,
          providerKey: 'cbf-copa-do-brasil-official',
        },
      },
      select: { active: true, enabledTypes: true, settings: true, source: true },
    }),
    prisma.syncQuarantine.count({ where: { seasonId, resolvedAt: null } }),
    prisma.tie.groupBy({ by: ['status'], where: { seasonId }, _count: true }),
    prisma.tie.groupBy({ by: ['expectedLegs'], where: { seasonId }, _count: true }),
    prisma.seasonTeam.findMany({ where: { seasonId }, select: { metadata: true } }),
  ]);
  const poolSeason = season.poolSeasons[0];
  const entryPhaseCounts = Object.fromEntries(
    [1, 2, 3, 4, 5].map((phase) => [
      String(phase),
      seasonTeams.filter((entry) => jsonObject(entry.metadata).entryPhase === phase).length,
    ]),
  );
  const statusCount = (status: string) =>
    tiesByStatus.find((entry) => entry.status === status)?._count ?? 0;
  const legCount = (legs: number) =>
    tiesByLegs.find((entry) => entry.expectedLegs === legs)?._count ?? 0;
  const passed =
    season.slug === COPA_DO_BRASIL_2026_SEASON_SLUG &&
    season.status === 'DRAFT' &&
    season.timezone === 'America/Sao_Paulo' &&
    season._count.teams === 126 &&
    season._count.stages === 1 &&
    season._count.rounds === 9 &&
    season._count.ties === 118 &&
    season._count.matches === 142 &&
    hasCopaDoBrasilCapabilities(season.capabilities) &&
    entryPhaseCounts['1'] === 28 &&
    entryPhaseCounts['2'] === 74 &&
    entryPhaseCounts['3'] === 4 &&
    entryPhaseCounts['4'] === 0 &&
    entryPhaseCounts['5'] === 20 &&
    Boolean(poolSeason) &&
    poolSeason!.historicalMatchesScoreable === false &&
    poolSeason!.scoreableFrom?.getTime() === COPA_DO_BRASIL_2026_SCOREABLE_FROM.getTime() &&
    poolSeason!.scoreableFromRound === 6 &&
    poolSeason!.startsAtRound === 6 &&
    poolSeason!.scoringRuleSet?.key === COPA_DO_BRASIL_2026_SEASON_SLUG.replace('-2026', '') &&
    scores === 0 &&
    historicalScores === 0 &&
    quarantines === 0 &&
    statusCount('DECIDED') === 110 &&
    statusCount('SCHEDULED') === 8 &&
    legCount(1) === 94 &&
    legCount(2) === 24 &&
    providerConfig.active &&
    providerConfig.enabledTypes.length === 5 &&
    flags.readEnabled === false &&
    flags.writeEnabled === false &&
    flags.uiEnabled === false &&
    flags.syncEnabled === false;
  if (!passed) {
    throw new Error(
      `Copa do Brasil administrative smoke failed: ${JSON.stringify({
        season,
        flags,
        scores,
        historicalScores,
        providerConfig,
        quarantines,
        entryPhaseCounts,
        tiesByStatus,
        tiesByLegs,
      })}`,
    );
  }
  return {
    status: 'PASS',
    season,
    flags,
    scores,
    historicalScores,
    providerConfig,
    quarantines,
    entryPhaseCounts,
    tiesByStatus,
    tiesByLegs,
  };
}
