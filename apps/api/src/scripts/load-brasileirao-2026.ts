import 'dotenv/config';
import { prisma } from '../prisma.js';
import {
  CbfSerieA2026Provider,
} from '../modules/providers/adapters/cbf-serie-a-2026.provider.js';
import {
  assertBrasileirao2026Readiness,
  prepareBrasileirao2026,
  refreshBrasileirao2026RoundWindows,
} from '../modules/brasileirao/brasileirao-2026.service.js';
import { runProviderSync } from '../modules/providers/provider-sync.service.js';
import { getCompetitionFeatureFlags } from '../modules/competitions/competition-feature.service.js';

async function sync(
  provider: CbfSerieA2026Provider,
  seasonId: string,
  type: 'TEAMS' | 'SCHEDULE' | 'RESULTS' | 'STANDINGS',
  dryRun: boolean,
  key: string,
) {
  return runProviderSync(provider, {
    seasonId,
    type,
    dryRun,
    idempotencyKey: key,
  });
}

async function main() {
  const provider = new CbfSerieA2026Provider();
  const context = { seasonId: 'preparation' };
  const [teams, schedule, evidence] = await Promise.all([
    provider.syncTeams(context),
    provider.syncSchedule(context),
    provider.evidence(),
  ]);
  const readiness = assertBrasileirao2026Readiness({ teams, schedule, evidence });
  const prepared = await prepareBrasileirao2026({ readiness, evidence });
  const seasonId = prepared.season.id;
  const prefix = `brasileirao-2026:${evidence.checksum.slice(0, 16)}`;

  const dryRuns = [];
  const applies = [];
  const verifications = [];
  dryRuns.push(await sync(provider, seasonId, 'TEAMS', true, `${prefix}:teams:dry`));
  applies.push(await sync(provider, seasonId, 'TEAMS', false, `${prefix}:teams:apply`));
  dryRuns.push(await sync(provider, seasonId, 'SCHEDULE', true, `${prefix}:schedule:dry`));
  applies.push(await sync(provider, seasonId, 'SCHEDULE', false, `${prefix}:schedule:apply`));
  dryRuns.push(await sync(provider, seasonId, 'RESULTS', true, `${prefix}:results:dry`));
  applies.push(await sync(provider, seasonId, 'RESULTS', false, `${prefix}:results:apply`));
  dryRuns.push(await sync(provider, seasonId, 'STANDINGS', true, `${prefix}:standings:dry`));
  applies.push(await sync(provider, seasonId, 'STANDINGS', false, `${prefix}:standings:apply`));
  await refreshBrasileirao2026RoundWindows(seasonId);

  for (const type of ['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS'] as const) {
    verifications.push(
      await sync(provider, seasonId, type, false, `${prefix}:${type.toLowerCase()}:verify`),
    );
  }
  const invalidVerification = verifications.find(
    (run) => run.counts.inserted !== 0 || run.counts.quarantined !== 0,
  );
  if (invalidVerification) {
    throw new Error(
      `Idempotency gate failed for ${invalidVerification.type}: ${JSON.stringify(invalidVerification.counts)}`,
    );
  }

  const [counts, flags] = await Promise.all([
    prisma.competitionSeason.findUniqueOrThrow({
      where: { id: seasonId },
      select: {
        _count: { select: { teams: true, rounds: true, matches: true } },
        poolSeasons: {
          select: {
            scoreableFromRound: true,
            startsAtRound: true,
            scoreableFrom: true,
            historicalMatchesScoreable: true,
          },
        },
      },
    }),
    getCompetitionFeatureFlags(seasonId),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        gate: 'PASS',
        seasonId,
        evidence,
        readiness,
        dryRuns: dryRuns.map((run) => ({ type: run.type, counts: run.counts, checksum: run.checksum })),
        applies: applies.map((run) => ({ type: run.type, counts: run.counts, checksum: run.checksum })),
        secondImport: verifications.map((run) => ({
          type: run.type,
          counts: run.counts,
          checksum: run.checksum,
        })),
        domain: counts,
        flags,
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
