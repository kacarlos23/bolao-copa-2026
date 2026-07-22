import 'dotenv/config';
import { prisma } from '../prisma.js';
import { getCompetitionFeatureFlags } from '../modules/competitions/competition-feature.service.js';
import {
  assertLibertadores2026Readiness,
  LIBERTADORES_2026_FIXTURE,
  LIBERTADORES_2026_SCOREABLE_FROM,
  LIBERTADORES_2026_SEASON_SLUG,
  linkLibertadoresThirdPlacedTransfers,
  prepareLibertadores2026,
} from '../modules/libertadores/libertadores-2026.service.js';
import { ConmebolProvider } from '../modules/providers/adapters/snapshot-competition.provider.js';
import { runProviderSync } from '../modules/providers/provider-sync.service.js';
import { SUDAMERICANA_2026_SEASON_SLUG } from '../modules/sudamericana/sudamericana-2026.service.js';

const syncTypes = ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS'] as const;
type Mode = 'dry-run' | 'apply' | 'verify';

function readMode(): Mode {
  if (process.argv.includes('--apply')) return 'apply';
  if (process.argv.includes('--verify')) return 'verify';
  if (process.argv.includes('--dry-run') || process.argv.length === 2) return 'dry-run';
  throw new Error('Use --dry-run, --apply or --verify.');
}

async function sourceState(provider: ConmebolProvider) {
  const context = { seasonId: 'source-reconciliation-only' };
  const [teams, structure, ties, schedule, results, standings, evidence] = await Promise.all([
    provider.syncTeams(context),
    provider.syncStructure!(context),
    provider.syncTies!(context),
    provider.syncSchedule(context),
    provider.syncResults(context),
    provider.syncStandings!(context),
    provider.snapshotEvidence!(),
  ]);
  const readiness = assertLibertadores2026Readiness({
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

async function administrativeSmoke(seasonId: string) {
  const [season, sudamericana, flags, historicalScores, quarantines, tiesByStatus] =
    await Promise.all([
      prisma.competitionSeason.findUniqueOrThrow({
        where: { id: seasonId },
        select: {
          slug: true,
          status: true,
          _count: {
            select: { teams: true, stages: true, rounds: true, ties: true, matches: true },
          },
          poolSeasons: {
            select: {
              id: true,
              scoreableFrom: true,
              historicalMatchesScoreable: true,
              scoringRuleSet: { select: { key: true, version: true, rules: true } },
            },
          },
          providerConfigs: {
            where: { providerKey: 'conmebol-official' },
            select: { active: true, enabledTypes: true, settings: true },
          },
        },
      }),
      prisma.competitionSeason.findFirstOrThrow({
        where: { slug: SUDAMERICANA_2026_SEASON_SLUG },
        select: { id: true, poolSeasons: { select: { id: true } } },
      }),
      getCompetitionFeatureFlags(seasonId),
      prisma.predictionScore.count({
        where: { match: { seasonId, startsAt: { lt: LIBERTADORES_2026_SCOREABLE_FROM } } },
      }),
      prisma.syncQuarantine.count({ where: { seasonId, resolvedAt: null } }),
      prisma.tie.groupBy({ by: ['status'], where: { seasonId }, _count: true }),
    ]);
  const poolSeason = season.poolSeasons[0];
  const sudamericanaPoolSeason = sudamericana.poolSeasons[0];
  if (!poolSeason || !sudamericanaPoolSeason) throw new Error('CONMEBOL PoolSeason missing.');
  const [crossSeasonRankings, crossSeasonEvents, exportedSeasonTeams] = await Promise.all([
    prisma.rankingSnapshot.count({
      where: {
        OR: [
          { seasonId, poolSeasonId: sudamericanaPoolSeason.id },
          { seasonId: sudamericana.id, poolSeasonId: poolSeason.id },
        ],
      },
    }),
    prisma.outboxEvent.count({
      where: {
        OR: [
          { seasonId, poolSeasonId: sudamericanaPoolSeason.id },
          { seasonId: sudamericana.id, poolSeasonId: poolSeason.id },
        ],
      },
    }),
    prisma.seasonTeam.count({
      where: {
        seasonId: { in: [seasonId, sudamericana.id] },
        metadata: {
          path: ['qualificationTransfer', 'route'],
          equals: 'LIBERTADORES_GROUP_THIRD_TO_SUDAMERICANA_PLAYOFFS',
        },
      },
    }),
  ]);
  const decidedTies = tiesByStatus.reduce(
    (total, entry) => total + (entry.status === 'DECIDED' ? entry._count : 0),
    0,
  );
  const scheduledTies = tiesByStatus.reduce(
    (total, entry) => total + (entry.status === 'SCHEDULED' ? entry._count : 0),
    0,
  );
  const providerConfig = season.providerConfigs[0];
  const passed =
    season.slug === LIBERTADORES_2026_SEASON_SLUG &&
    season.status === 'DRAFT' &&
    season._count.teams === 47 &&
    season._count.stages === 3 &&
    season._count.rounds === 13 &&
    season._count.ties === 23 &&
    season._count.matches === 142 &&
    poolSeason.historicalMatchesScoreable === false &&
    poolSeason.scoreableFrom?.getTime() === LIBERTADORES_2026_SCOREABLE_FROM.getTime() &&
    historicalScores === 0 &&
    quarantines === 0 &&
    decidedTies === 15 &&
    scheduledTies === 8 &&
    providerConfig?.active === true &&
    exportedSeasonTeams === 16 &&
    crossSeasonRankings === 0 &&
    crossSeasonEvents === 0 &&
    !flags.readEnabled &&
    !flags.writeEnabled &&
    !flags.uiEnabled &&
    !flags.syncEnabled;
  if (!passed) throw new Error('Libertadores administrative canary smoke failed.');
  return {
    status: 'PASS',
    season,
    flags,
    historicalScores,
    quarantines,
    tiesByStatus,
    exportedSeasonTeams,
    crossSeasonRankings,
    crossSeasonEvents,
  };
}

async function main() {
  const mode = readMode();
  const provider = new ConmebolProvider({
    fixtureName: LIBERTADORES_2026_FIXTURE,
    competition: 'conmebol-libertadores',
  });
  const source = await sourceState(provider);
  if (mode === 'dry-run') {
    process.stdout.write(
      `${JSON.stringify(
        {
          gate: 'PASS',
          mode,
          domainWrites: 0,
          evidence: source.evidence,
          readiness: source.readiness,
          plannedSyncTypes: syncTypes,
          plannedTransferLinks: source.readiness.sudamericanaTransfers,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  let season = await prisma.competitionSeason.findFirst({
    where: { slug: LIBERTADORES_2026_SEASON_SLUG },
    select: { id: true },
  });
  if (mode === 'apply') {
    const prepared = await prepareLibertadores2026({
      readiness: source.readiness,
      evidence: source.evidence,
    });
    season = { id: prepared.season.id };
  }
  if (!season) throw new Error('Run --apply before --verify.');

  const prefix = `libertadores-2026:${source.evidence.checksum.slice(0, 16)}`;
  const runs = [];
  for (const type of syncTypes) {
    runs.push(
      await runProviderSync(provider, {
        seasonId: season.id,
        type,
        mode: mode === 'verify' ? 'VERIFY' : 'APPLY',
        idempotencyKey: `${prefix}:${type.toLowerCase()}:${mode}`,
      }),
    );
  }
  if (runs.some((run) => run.counts.quarantined !== 0)) {
    throw new Error(`Provider reconciliation quarantined data: ${JSON.stringify(runs)}`);
  }
  if (
    mode === 'verify' &&
    runs.some((run) => run.counts.inserted !== 0 || run.counts.updated !== 0)
  ) {
    throw new Error(`Second import was not idempotent: ${JSON.stringify(runs)}`);
  }
  const transferLinks = await linkLibertadoresThirdPlacedTransfers({
    standings: source.standings,
    evidence: source.evidence,
    apply: mode === 'apply',
  });
  const smoke = await administrativeSmoke(season.id);
  process.stdout.write(
    `${JSON.stringify(
      {
        gate: 'PASS',
        mode,
        seasonId: season.id,
        evidence: source.evidence,
        readiness: source.readiness,
        transferLinks,
        runs: runs.map((run) => ({
          type: run.type,
          status: run.status,
          checksum: run.checksum,
          counts: run.counts,
        })),
        administrativeSmoke: smoke,
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
