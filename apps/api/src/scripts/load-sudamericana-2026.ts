import 'dotenv/config';
import { prisma } from '../prisma.js';
import { getCompetitionFeatureFlags } from '../modules/competitions/competition-feature.service.js';
import { ConmebolProvider } from '../modules/providers/adapters/snapshot-competition.provider.js';
import { runProviderSync } from '../modules/providers/provider-sync.service.js';
import {
  assertSudamericana2026Readiness,
  prepareSudamericana2026,
  SUDAMERICANA_2026_FIXTURE,
  SUDAMERICANA_2026_SEASON_SLUG,
} from '../modules/sudamericana/sudamericana-2026.service.js';

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
  const readiness = assertSudamericana2026Readiness({
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

async function adminSmoke(seasonId: string) {
  const [season, flags, scores, providerConfig, quarantines, tiesByStatus] = await Promise.all([
    prisma.competitionSeason.findUniqueOrThrow({
      where: { id: seasonId },
      select: {
        slug: true,
        status: true,
        _count: { select: { teams: true, stages: true, rounds: true, ties: true, matches: true } },
        poolSeasons: {
          select: {
            id: true,
            scoreableFrom: true,
            historicalMatchesScoreable: true,
            scoringRuleSet: { select: { key: true, version: true, rules: true } },
          },
        },
      },
    }),
    getCompetitionFeatureFlags(seasonId),
    prisma.predictionScore.count({ where: { match: { seasonId } } }),
    prisma.seasonProviderConfig.findUniqueOrThrow({
      where: { seasonId_providerKey: { seasonId, providerKey: 'conmebol-official' } },
      select: { active: true, enabledTypes: true, settings: true },
    }),
    prisma.syncQuarantine.count({ where: { seasonId, resolvedAt: null } }),
    prisma.tie.groupBy({
      by: ['status'],
      where: { seasonId },
      _count: true,
    }),
  ]);
  const poolSeason = season.poolSeasons[0];
  const passed =
    season.slug === SUDAMERICANA_2026_SEASON_SLUG &&
    season.status === 'DRAFT' &&
    season._count.teams === 56 &&
    season._count.stages === 3 &&
    season._count.rounds === 12 &&
    season._count.ties === 24 &&
    season._count.matches === 128 &&
    Boolean(poolSeason) &&
    poolSeason!.historicalMatchesScoreable === false &&
    poolSeason!.scoreableFrom?.toISOString() === '2026-08-12T12:00:00.000Z' &&
    scores === 0 &&
    quarantines === 0 &&
    tiesByStatus.reduce(
      (total, entry) => total + (entry.status === 'DECIDED' ? entry._count : 0),
      0,
    ) === 16 &&
    providerConfig.active &&
    !flags.readEnabled &&
    !flags.writeEnabled &&
    !flags.uiEnabled &&
    !flags.syncEnabled;
  if (!passed) throw new Error('Administrative canary smoke failed.');
  return {
    status: 'PASS',
    season,
    flags,
    scores,
    providerConfig,
    quarantines,
    tiesByStatus,
  };
}

async function main() {
  const mode = readMode();
  const provider = new ConmebolProvider({
    fixtureName: SUDAMERICANA_2026_FIXTURE,
    competition: 'conmebol-sudamericana',
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
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  let season = await prisma.competitionSeason.findFirst({
    where: { slug: SUDAMERICANA_2026_SEASON_SLUG },
    select: { id: true },
  });
  if (mode === 'apply') {
    const prepared = await prepareSudamericana2026({
      readiness: source.readiness,
      evidence: source.evidence,
    });
    season = { id: prepared.season.id };
  }
  if (!season) throw new Error('Run --apply before --verify.');

  const prefix = `sudamericana-2026:${source.evidence.checksum.slice(0, 16)}`;
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
  const smoke = await adminSmoke(season.id);
  process.stdout.write(
    `${JSON.stringify(
      {
        gate: 'PASS',
        mode,
        seasonId: season.id,
        evidence: source.evidence,
        readiness: source.readiness,
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
