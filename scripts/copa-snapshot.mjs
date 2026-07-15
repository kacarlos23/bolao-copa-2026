import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const WORLD_CUP_SEASON_ID = 'competition-season-world-cup-2026';
const WORLD_CUP_POOL_SEASON_ID = 'pool-season-bolao-do-trabalho-world-cup-2026';

function readOutputArgument(argv) {
  const inline = argv.find((argument) => argument.startsWith('--output='));
  if (inline) return inline.slice('--output='.length);

  const index = argv.indexOf('--output');
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return path.join('snapshots', 'world-cup-2026.json');
}

function integer(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Valor invalido em ${field}: ${value}`);
  }
  return parsed;
}

function mapUserTotal(row) {
  const exactScores = integer(row.exactScores, 'exactScores');
  const resultHits = integer(row.resultHits, 'resultHits');
  const oneGoalHits = integer(row.oneGoalHits, 'oneGoalHits');

  return {
    userId: row.userId,
    nickname: row.nickname,
    role: row.role,
    status: row.status,
    points: integer(row.points, 'points'),
    finalPoints: integer(row.finalPoints, 'finalPoints'),
    scoredPredictions: integer(row.scoredPredictions, 'scoredPredictions'),
    exactScores,
    resultHits,
    oneGoalHits,
    totalHits: exactScores + resultHits + oneGoalHits,
    misses: integer(row.misses, 'misses'),
    hasLiveData: row.hasLiveData,
  };
}

const rankingCollator = new Intl.Collator('pt-BR');

function compareRankingRows(a, b) {
  return (
    b.points - a.points ||
    b.exactScores - a.exactScores ||
    b.resultHits - a.resultHits ||
    b.oneGoalHits - a.oneGoalHits ||
    a.misses - b.misses ||
    rankingCollator.compare(a.nickname, b.nickname) ||
    a.userId.localeCompare(b.userId)
  );
}

function sha256Rows(rows) {
  const hash = createHash('sha256');
  for (const row of rows.map(({ row }) => row).sort()) {
    hash.update(row);
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function createContentHashes(client) {
  const filters = {
    Competition:
      'WHERE source_row."id" IN (SELECT "competitionId" FROM "CompetitionSeason" WHERE "id" = $1)',
    CompetitionSeason: 'WHERE source_row."id" = $1',
    Stage: 'WHERE source_row."seasonId" = $1',
    Round: 'WHERE source_row."seasonId" = $1',
    SeasonTeam: 'WHERE source_row."seasonId" = $1',
    Team:
      'WHERE source_row."id" IN (SELECT "teamId" FROM "SeasonTeam" WHERE "seasonId" = $1)',
    MatchDay: 'WHERE source_row."seasonId" = $1',
    Match: 'WHERE source_row."seasonId" = $1',
    Prediction:
      'WHERE source_row."matchId" IN (SELECT "id" FROM "Match" WHERE "seasonId" = $1)',
    PredictionScore:
      'WHERE source_row."matchId" IN (SELECT "id" FROM "Match" WHERE "seasonId" = $1)',
    KnockoutFixture: 'WHERE source_row."seasonId" = $1',
    KnockoutGeneration: 'WHERE source_row."seasonId" = $1',
    KnockoutBracket: 'WHERE source_row."poolSeasonId" = $2',
    KnockoutPick: 'WHERE source_row."poolSeasonId" = $2',
    KnockoutGroupSimulationScore: 'WHERE source_row."poolSeasonId" = $2',
    KnockoutPredictionScore: 'WHERE source_row."poolSeasonId" = $2',
    RankingSnapshot: 'WHERE source_row."poolSeasonId" = $2',
    PoolSeason: 'WHERE source_row."id" = $2',
    Pool: 'WHERE source_row."id" IN (SELECT "poolId" FROM "PoolSeason" WHERE "id" = $2)',
    ScoringRuleSet:
      'WHERE source_row."id" IN (SELECT "scoringRuleSetId" FROM "PoolSeason" WHERE "id" = $2)',
    MatchOverride:
      'WHERE source_row."matchId" IN (SELECT "id" FROM "Match" WHERE "seasonId" = $1)',
  };
  const contentHashes = {};

  for (const [tableName, where] of Object.entries(filters)) {
    const identifier = tableName.replaceAll('"', '""');
    const usesSeason = where.includes('$1');
    const usesPoolSeason = where.includes('$2');
    const queryWhere = !usesSeason && usesPoolSeason ? where.replaceAll('$2', '$1') : where;
    const parameters = usesSeason
      ? usesPoolSeason
        ? [WORLD_CUP_SEASON_ID, WORLD_CUP_POOL_SEASON_ID]
        : [WORLD_CUP_SEASON_ID]
      : [WORLD_CUP_POOL_SEASON_ID];
    const rows = await client.query(
      `SELECT to_jsonb(source_row)::text AS row FROM public."${identifier}" source_row ${queryWhere}`,
      parameters,
    );
    contentHashes[tableName] = sha256Rows(rows.rows);
  }

  return contentHashes;
}

const BUSINESS_HASH_TABLES = {
  User: ['sessionVersion'],
  Team: ['type', 'crestUrl', 'updatedAt'],
  MatchDay: ['seasonId', 'updatedAt'],
  Match: ['seasonId', 'stageId', 'roundId', 'predictionClosesAt', 'updatedAt'],
  Prediction: ['poolSeasonId', 'updatedAt'],
  PredictionScore: ['poolSeasonId'],
  KnockoutFixture: ['seasonId', 'updatedAt'],
  KnockoutGeneration: ['seasonId', 'updatedAt'],
  KnockoutBracket: ['poolSeasonId', 'updatedAt'],
  KnockoutPick: ['poolSeasonId', 'updatedAt'],
  KnockoutGroupSimulationScore: ['poolSeasonId', 'updatedAt'],
  KnockoutPredictionScore: ['poolSeasonId'],
  RankingSnapshot: ['seasonId', 'poolSeasonId', 'roundId'],
};

async function createBusinessContentHashes(client) {
  const hashes = {};
  for (const [tableName, ignoredColumns] of Object.entries(BUSINESS_HASH_TABLES)) {
    const identifier = tableName.replaceAll('"', '""');
    const rows = await client.query(
      `SELECT (to_jsonb(source_row) - $1::text[])::text AS row
       FROM public."${identifier}" source_row`,
      [ignoredColumns],
    );
    hashes[tableName] = sha256Rows(rows.rows);
  }
  return hashes;
}

async function createSnapshot(client, { includeBusinessHashes = false } = {}) {
  const countsResult = await client.query(`
    SELECT
      (SELECT COUNT(*)::text FROM "User" WHERE "status" = 'ACTIVE') AS "activeUsers",
      (SELECT COUNT(*)::text FROM "Match" WHERE "seasonId" = $1) AS "matches",
      (
        (SELECT COUNT(*) FROM "Prediction" WHERE "poolSeasonId" = $2) +
        (SELECT COUNT(*) FROM "KnockoutPick" WHERE "poolSeasonId" = $2) +
        (SELECT COUNT(*) FROM "KnockoutGroupSimulationScore" WHERE "poolSeasonId" = $2)
      )::text AS "predictions",
      (
        (SELECT COUNT(*) FROM "PredictionScore" WHERE "poolSeasonId" = $2) +
        (SELECT COUNT(*) FROM "KnockoutPredictionScore" WHERE "poolSeasonId" = $2)
      )::text AS "scores",
      (SELECT COUNT(*)::text FROM "KnockoutFixture" WHERE "seasonId" = $1) AS "knockoutFixtures",
      (SELECT COUNT(*)::text FROM "PredictionScore" WHERE "poolSeasonId" = $2) AS "groupScores",
      (SELECT COUNT(*)::text FROM "KnockoutPredictionScore" WHERE "poolSeasonId" = $2) AS "knockoutScores",
      (SELECT COUNT(*)::text FROM "Prediction" WHERE "poolSeasonId" = $2) AS "matchPredictions",
      (SELECT COUNT(*)::text FROM "KnockoutPick" WHERE "poolSeasonId" = $2) AS "knockoutPicks",
      (SELECT COUNT(*)::text FROM "KnockoutGroupSimulationScore" WHERE "poolSeasonId" = $2) AS "knockoutGroupSimulations"
  `, [WORLD_CUP_SEASON_ID, WORLD_CUP_POOL_SEASON_ID]);

  const totalsResult = await client.query(`
    WITH all_scores AS (
      SELECT "userId", "points", "scoreType"::text AS "scoreType", "isFinal"
      FROM "PredictionScore"
      WHERE "poolSeasonId" = $1
      UNION ALL
      SELECT "userId", "points", "scoreType"::text AS "scoreType", "isFinal"
      FROM "KnockoutPredictionScore"
      WHERE "poolSeasonId" = $1
    ), score_totals AS (
      SELECT
        "userId",
        COALESCE(SUM("points"), 0)::text AS "points",
        COALESCE(SUM("points") FILTER (WHERE "isFinal"), 0)::text AS "finalPoints",
        COUNT(*)::text AS "scoredPredictions",
        COUNT(*) FILTER (WHERE "scoreType" = 'EXACT_SCORE')::text AS "exactScores",
        COUNT(*) FILTER (WHERE "scoreType" = 'RESULT')::text AS "resultHits",
        COUNT(*) FILTER (WHERE "scoreType" = 'ONE_TEAM_GOALS')::text AS "oneGoalHits",
        COUNT(*) FILTER (WHERE "scoreType" = 'MISS')::text AS "misses",
        BOOL_OR(NOT "isFinal") AS "hasLiveData"
      FROM all_scores
      GROUP BY "userId"
    )
    SELECT
      users."id" AS "userId",
      users."nickname",
      users."role"::text AS "role",
      users."status"::text AS "status",
      COALESCE(totals."points", '0') AS "points",
      COALESCE(totals."finalPoints", '0') AS "finalPoints",
      COALESCE(totals."scoredPredictions", '0') AS "scoredPredictions",
      COALESCE(totals."exactScores", '0') AS "exactScores",
      COALESCE(totals."resultHits", '0') AS "resultHits",
      COALESCE(totals."oneGoalHits", '0') AS "oneGoalHits",
      COALESCE(totals."misses", '0') AS "misses",
      COALESCE(totals."hasLiveData", false) AS "hasLiveData"
    FROM "User" users
    LEFT JOIN score_totals totals ON totals."userId" = users."id"
    WHERE users."role" = 'USER'
    ORDER BY users."id" ASC
  `, [WORLD_CUP_POOL_SEASON_ID]);

  const counts = countsResult.rows[0];
  const userTotals = totalsResult.rows.map(mapUserTotal);
  const ranking = userTotals
    .filter((user) => user.status === 'ACTIVE')
    .sort(compareRankingRows)
    .map(({ role: _role, status: _status, ...user }, index) => ({
      rank: index + 1,
      ...user,
    }));

  const contentHashes = await createContentHashes(client);
  const businessContentHashes = includeBusinessHashes
    ? await createBusinessContentHashes(client)
    : null;

  return {
    formatVersion: 1,
    scope: 'world-cup-2026',
    counts: {
      activeUsers: integer(counts.activeUsers, 'activeUsers'),
      matches: integer(counts.matches, 'matches'),
      predictions: integer(counts.predictions, 'predictions'),
      scores: integer(counts.scores, 'scores'),
      knockoutFixtures: integer(counts.knockoutFixtures, 'knockoutFixtures'),
    },
    scoreCounts: {
      group: integer(counts.groupScores, 'groupScores'),
      knockout: integer(counts.knockoutScores, 'knockoutScores'),
    },
    predictionCounts: {
      matches: integer(counts.matchPredictions, 'matchPredictions'),
      knockoutPicks: integer(counts.knockoutPicks, 'knockoutPicks'),
      knockoutGroupSimulations: integer(
        counts.knockoutGroupSimulations,
        'knockoutGroupSimulations',
      ),
    },
    contentHashAlgorithm: 'sha256',
    contentHashes,
    ...(businessContentHashes ? { businessContentHashes } : {}),
    ranking,
    userTotals,
  };
}

async function main() {
  const databaseUrl =
    process.env.SNAPSHOT_DATABASE_URL ??
    process.env.DATABASE_URL ??
    process.env.BACKUP_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Configure SNAPSHOT_DATABASE_URL, DATABASE_URL ou BACKUP_DATABASE_URL.');
  }

  const output = path.resolve(readOutputArgument(process.argv.slice(2)));
  const client = new Client({ connectionString: databaseUrl, application_name: 'copa-snapshot' });

  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('A transacao do snapshot nao esta em modo somente leitura.');
    }

    const snapshot = await createSnapshot(client, {
      includeBusinessHashes: process.argv.slice(2).includes('--backfill'),
    });
    await client.query('COMMIT');

    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'w',
    });
    process.stdout.write(`Snapshot deterministico criado: ${output}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`Falha ao criar snapshot: ${error.message}\n`);
  process.exitCode = 1;
});
