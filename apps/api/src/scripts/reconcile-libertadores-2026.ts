import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma.js';
import { groupStandingDifferences } from '../modules/conmebol/standings-reconciliation.js';
import {
  assertLibertadores2026Readiness,
  LIBERTADORES_2026_FIXTURE,
  LIBERTADORES_2026_SCOREABLE_FROM,
  LIBERTADORES_2026_SEASON_SLUG,
  linkLibertadoresThirdPlacedTransfers,
} from '../modules/libertadores/libertadores-2026.service.js';
import { ConmebolProvider } from '../modules/providers/adapters/snapshot-competition.provider.js';
import type { NormalizedStanding } from '../modules/providers/competition-data-provider.js';
import { SUDAMERICANA_2026_SEASON_SLUG } from '../modules/sudamericana/sudamericana-2026.service.js';

async function databaseChecks(
  standings: NormalizedStanding[],
  evidence: Awaited<ReturnType<ConmebolProvider['snapshotEvidence']>>,
) {
  const [season, sudamericana] = await Promise.all([
    prisma.competitionSeason.findFirstOrThrow({
      where: { slug: LIBERTADORES_2026_SEASON_SLUG },
      select: {
        id: true,
        poolSeasons: {
          select: { id: true, historicalMatchesScoreable: true, scoreableFrom: true },
        },
      },
    }),
    prisma.competitionSeason.findFirstOrThrow({
      where: { slug: SUDAMERICANA_2026_SEASON_SLUG },
      select: { id: true, poolSeasons: { select: { id: true } } },
    }),
  ]);
  const poolSeason = season.poolSeasons[0];
  const sudamericanaPoolSeason = sudamericana.poolSeasons[0];
  if (!poolSeason || !sudamericanaPoolSeason) throw new Error('CONMEBOL PoolSeason missing.');
  const transferLinks = await linkLibertadoresThirdPlacedTransfers({
    standings,
    evidence,
    apply: false,
  });
  const [historicalScores, crossRankings, crossEvents, duplicateMatchIds] = await Promise.all([
    prisma.predictionScore.count({
      where: { match: { seasonId: season.id, startsAt: { lt: LIBERTADORES_2026_SCOREABLE_FROM } } },
    }),
    prisma.rankingSnapshot.count({
      where: {
        OR: [
          { seasonId: season.id, poolSeasonId: sudamericanaPoolSeason.id },
          { seasonId: sudamericana.id, poolSeasonId: poolSeason.id },
        ],
      },
    }),
    prisma.outboxEvent.count({
      where: {
        OR: [
          { seasonId: season.id, poolSeasonId: sudamericanaPoolSeason.id },
          { seasonId: sudamericana.id, poolSeasonId: poolSeason.id },
        ],
      },
    }),
    prisma.$queryRaw<Array<{ externalId: string; seasons: bigint }>>`
      SELECT match."externalId", COUNT(DISTINCT match."seasonId") AS seasons
      FROM "Match" match
      WHERE match."seasonId" IN (${season.id}, ${sudamericana.id})
      GROUP BY match."externalId"
      HAVING COUNT(DISTINCT match."seasonId") > 1
    `,
  ]);
  if (
    historicalScores !== 0 ||
    crossRankings !== 0 ||
    crossEvents !== 0 ||
    duplicateMatchIds.length !== 0 ||
    poolSeason.historicalMatchesScoreable ||
    poolSeason.scoreableFrom?.getTime() !== LIBERTADORES_2026_SCOREABLE_FROM.getTime()
  ) {
    throw new Error('Database reconciliation failed for scoreability or competition isolation.');
  }
  return {
    status: 'PASS',
    historicalScores,
    crossRankings,
    crossEvents,
    duplicateMatchIds: duplicateMatchIds.length,
    globalTransferTeams: transferLinks.linkedTeams,
    scoreableFrom: poolSeason.scoreableFrom.toISOString(),
  };
}

const provider = new ConmebolProvider({
  fixtureName: LIBERTADORES_2026_FIXTURE,
  competition: 'conmebol-libertadores',
});
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
const groupMatchIds = new Set(
  schedule
    .filter((match) => match.stageExternalId === 'stage:groups')
    .map((match) => match.externalId),
);
const groupResults = results.filter(
  (result) => result.matchExternalId && groupMatchIds.has(result.matchExternalId),
);
const differences = groupStandingDifferences(groupResults, standings);
const groupCounts = Object.fromEntries(
  [...new Set(standings.map((standing) => standing.groupName))].map((group) => [
    group,
    standings.filter((standing) => standing.groupName === group).length,
  ]),
);
const preliminaryTies = ties.filter((tie) => tie.stageExternalId === 'stage:preliminary');
const roundOf16Ties = ties.filter((tie) => tie.roundExternalId === 'round:round-of-16');
const matchesByTie = new Map<string, typeof schedule>();
for (const match of schedule.filter((entry) => entry.tieExternalId)) {
  const entries = matchesByTie.get(match.tieExternalId!) ?? [];
  entries.push(match);
  matchesByTie.set(match.tieExternalId!, entries);
}
const invalidTies = ties.filter((tie) => {
  const legs = matchesByTie.get(tie.externalId) ?? [];
  return (
    legs.length !== tie.expectedLegs ||
    new Set(legs.map((leg) => leg.legNumber)).size !== legs.length
  );
});
const firstFutureMatch = schedule
  .filter(
    (match) =>
      Boolean(match.startsAt) && new Date(match.startsAt!) >= LIBERTADORES_2026_SCOREABLE_FROM,
  )
  .sort((left, right) => left.startsAt!.localeCompare(right.startsAt!))[0];
if (
  differences.length > 0 ||
  Object.values(groupCounts).some((count) => count !== 4) ||
  groupResults.length !== 96 ||
  preliminaryTies.length !== 15 ||
  preliminaryTies.some((tie) => tie.status !== 'DECIDED') ||
  roundOf16Ties.length !== 8 ||
  roundOf16Ties.some((tie) => tie.status !== 'SCHEDULED') ||
  invalidTies.length > 0 ||
  !firstFutureMatch?.kickoffConfirmed ||
  !firstFutureMatch.venue?.name ||
  firstFutureMatch.startsAt! !== LIBERTADORES_2026_SCOREABLE_FROM.toISOString()
) {
  throw new Error(
    `Official reconciliation failed: ${JSON.stringify({
      differences,
      groupCounts,
      groupResults: groupResults.length,
      preliminaryTies: preliminaryTies.length,
      roundOf16Ties: roundOf16Ties.length,
      invalidTies: invalidTies.map((tie) => tie.externalId),
      firstFutureMatch,
    })}`,
  );
}

const verifyDatabase = process.argv.includes('--verify-db');
const report = {
  gate: 'PASS',
  mode: verifyDatabase ? 'verify-db' : 'dry-run',
  checkedAt: new Date().toISOString(),
  evidence,
  readiness,
  reconciliation: {
    groupResults: groupResults.length,
    standingsDifferences: differences.length,
    groupCounts,
    preliminaryTies: preliminaryTies.length,
    roundOf16Ties: roundOf16Ties.length,
    deferredBracketSlots: readiness.deferredBracketSlots,
    firstScoreableMatch: {
      externalId: firstFutureMatch.externalId,
      startsAt: firstFutureMatch.startsAt,
      venue: firstFutureMatch.venue,
    },
  },
  database: verifyDatabase ? await databaseChecks(standings, evidence) : null,
};
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const output = outputArgument
  ? path.resolve(outputArgument.slice('--output='.length))
  : path.resolve('output', 'libertadores-2026-reconciliation.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ...report, output }, null, 2)}\n`);
await prisma.$disconnect();
