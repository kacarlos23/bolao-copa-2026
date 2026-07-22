import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../prisma.js';
import { ConmebolProvider } from '../modules/providers/adapters/snapshot-competition.provider.js';
import type {
  NormalizedResult,
  NormalizedStanding,
} from '../modules/providers/competition-data-provider.js';
import {
  assertSudamericana2026Readiness,
  SUDAMERICANA_2026_FIXTURE,
  SUDAMERICANA_2026_SCOREABLE_FROM,
  SUDAMERICANA_2026_SEASON_SLUG,
} from '../modules/sudamericana/sudamericana-2026.service.js';

type DerivedStanding = Pick<
  NormalizedStanding,
  'played' | 'won' | 'drawn' | 'lost' | 'goalsFor' | 'goalsAgainst' | 'points'
>;

function blank(): DerivedStanding {
  return { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

function deriveStandings(results: NormalizedResult[]) {
  const rows = new Map<string, DerivedStanding>();
  for (const result of results) {
    if (!result.homeTeamExternalId || !result.awayTeamExternalId) {
      throw new Error(`Result ${result.externalId} has no official team IDs.`);
    }
    const home = rows.get(result.homeTeamExternalId) ?? blank();
    const away = rows.get(result.awayTeamExternalId) ?? blank();
    home.played += 1;
    away.played += 1;
    home.goalsFor += result.homeScore;
    home.goalsAgainst += result.awayScore;
    away.goalsFor += result.awayScore;
    away.goalsAgainst += result.homeScore;
    if (result.homeScore > result.awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (result.homeScore < result.awayScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
    rows.set(result.homeTeamExternalId, home);
    rows.set(result.awayTeamExternalId, away);
  }
  return rows;
}

function standingDifferences(results: NormalizedResult[], standings: NormalizedStanding[]) {
  const derived = deriveStandings(results);
  const fields: Array<keyof DerivedStanding> = [
    'played',
    'won',
    'drawn',
    'lost',
    'goalsFor',
    'goalsAgainst',
    'points',
  ];
  return standings.flatMap((standing) => {
    const calculated = standing.teamExternalId ? derived.get(standing.teamExternalId) : undefined;
    return fields
      .filter((field) => !calculated || calculated[field] !== standing[field])
      .map((field) => ({
        teamExternalId: standing.teamExternalId,
        teamName: standing.teamName,
        field,
        official: standing[field],
        derived: calculated?.[field] ?? null,
      }));
  });
}

async function databaseChecks(transferredIds: string[]) {
  const season = await prisma.competitionSeason.findFirstOrThrow({
    where: { slug: SUDAMERICANA_2026_SEASON_SLUG },
    select: {
      id: true,
      poolSeasons: {
        select: { id: true, historicalMatchesScoreable: true, scoreableFrom: true },
      },
    },
  });
  const [historicalScores, mappings, duplicateMappings] = await Promise.all([
    prisma.predictionScore.count({
      where: {
        match: { seasonId: season.id, startsAt: { lt: SUDAMERICANA_2026_SCOREABLE_FROM } },
      },
    }),
    prisma.providerEntityMapping.findMany({
      where: {
        provider: 'conmebol-official',
        seasonId: season.id,
        entityType: 'TEAM',
      },
      select: { internalId: true, metadata: true },
    }),
    prisma.$queryRaw<Array<{ rawExternalId: string; globalTeamCount: bigint }>>`
      SELECT mapping.metadata->>'rawExternalId' AS "rawExternalId",
             COUNT(DISTINCT mapping."internalId") AS "globalTeamCount"
      FROM "ProviderEntityMapping" mapping
      WHERE mapping.provider = 'conmebol-official'
        AND mapping."entityType" = 'TEAM'
        AND mapping.metadata->>'rawExternalId' IN (${Prisma.join(transferredIds)})
      GROUP BY mapping.metadata->>'rawExternalId'
      HAVING COUNT(DISTINCT mapping."internalId") > 1
    `,
  ]);
  const mappedTransfers = new Set(
    mappings
      .filter((mapping) => {
        const metadata = mapping.metadata as { rawExternalId?: string } | null;
        return metadata?.rawExternalId && transferredIds.includes(metadata.rawExternalId);
      })
      .map((mapping) => mapping.internalId),
  );
  const poolSeason = season.poolSeasons[0];
  if (
    historicalScores !== 0 ||
    duplicateMappings.length !== 0 ||
    mappedTransfers.size !== 8 ||
    !poolSeason ||
    poolSeason.historicalMatchesScoreable ||
    poolSeason.scoreableFrom?.getTime() !== SUDAMERICANA_2026_SCOREABLE_FROM.getTime()
  ) {
    throw new Error('Database reconciliation failed for historical scoring or global Team reuse.');
  }
  return {
    status: 'PASS',
    historicalScores,
    transferredTeamsMappedOnce: mappedTransfers.size,
    duplicateGlobalTeamMappings: duplicateMappings.length,
    scoreableFrom: poolSeason.scoreableFrom.toISOString(),
  };
}

const provider = new ConmebolProvider({
  fixtureName: SUDAMERICANA_2026_FIXTURE,
  competition: 'conmebol-sudamericana',
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
const readiness = assertSudamericana2026Readiness({
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
const differences = standingDifferences(groupResults, standings);
const groupCounts = Object.fromEntries(
  [...new Set(standings.map((standing) => standing.groupName))].map((group) => [
    group,
    standings.filter((standing) => standing.groupName === group).length,
  ]),
);
const groupSeconds = new Set(
  standings
    .filter((standing) => standing.position === 2)
    .map((standing) => standing.teamExternalId),
);
const transferredIds = teams
  .filter((team) => team.providerMetadata?.entryRoute === 'LIBERTADORES_GROUP_THIRD')
  .map((team) => team.externalId);
const transferred = new Set(transferredIds);
const playoffTies = ties.filter((tie) => tie.roundExternalId === 'round:playoffs');
const invalidPlayoffs = playoffTies.filter((tie) => {
  const participants = [tie.teamAExternalId, tie.teamBExternalId];
  return (
    participants.filter((id) => id && groupSeconds.has(id)).length !== 1 ||
    participants.filter((id) => id && transferred.has(id)).length !== 1
  );
});
const futureConcreteTies = ties.filter((tie) =>
  ['round:round-of-16', 'round:quarterfinals', 'round:semifinals', 'round:final'].includes(
    tie.roundExternalId,
  ),
);
if (
  differences.length > 0 ||
  Object.values(groupCounts).some((count) => count !== 4) ||
  groupResults.length !== 96 ||
  playoffTies.length !== 8 ||
  invalidPlayoffs.length > 0 ||
  futureConcreteTies.length > 0 ||
  schedule.some((match) => match.homeTeamName === 'Unknown' || match.awayTeamName === 'Unknown')
) {
  throw new Error(
    `Official reconciliation failed: ${JSON.stringify({
      differences,
      groupCounts,
      groupResults: groupResults.length,
      playoffTies: playoffTies.length,
      invalidPlayoffs,
      futureConcreteTies,
    })}`,
  );
}
const verifyDb = process.argv.includes('--verify-db');
const db = verifyDb ? await databaseChecks(transferredIds) : null;
const report = {
  formatVersion: 1,
  suite: 'conmebol-sudamericana-2026-source-reconciliation',
  status: 'passed',
  mode: verifyDb ? 'verify-db' : 'dry-run',
  generatedAt: new Date().toISOString(),
  productionEvidence: false,
  evidence,
  readiness,
  gates: {
    groups: groupCounts,
    groupResults: groupResults.length,
    standingsDifferences: differences.length,
    playoffTies: playoffTies.length,
    invalidPlayoffs: invalidPlayoffs.length,
    futureTiesDeferredUntilParticipantsAreOfficial: futureConcreteTies.length,
    unknownTeamsPersisted: 0,
    database: db,
  },
};
const outputDir = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'output',
  'release-gates',
);
await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, 'conmebol-sudamericana-2026-reconciliation-local.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await prisma.$disconnect();
