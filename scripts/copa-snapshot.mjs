import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;

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
  const tables = await client.query(`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name ASC
  `);
  const contentHashes = {};

  for (const { tableName } of tables.rows) {
    const identifier = tableName.replaceAll('"', '""');
    const rows = await client.query(
      `SELECT to_jsonb(source_row)::text AS row FROM public."${identifier}" source_row`,
    );
    contentHashes[tableName] = sha256Rows(rows.rows);
  }

  return contentHashes;
}

async function createSnapshot(client) {
  const countsResult = await client.query(`
    SELECT
      (SELECT COUNT(*)::text FROM "User" WHERE "status" = 'ACTIVE') AS "activeUsers",
      (SELECT COUNT(*)::text FROM "Match") AS "matches",
      (
        (SELECT COUNT(*) FROM "Prediction") +
        (SELECT COUNT(*) FROM "KnockoutPick") +
        (SELECT COUNT(*) FROM "KnockoutGroupSimulationScore")
      )::text AS "predictions",
      (
        (SELECT COUNT(*) FROM "PredictionScore") +
        (SELECT COUNT(*) FROM "KnockoutPredictionScore")
      )::text AS "scores",
      (SELECT COUNT(*)::text FROM "KnockoutFixture") AS "knockoutFixtures",
      (SELECT COUNT(*)::text FROM "PredictionScore") AS "groupScores",
      (SELECT COUNT(*)::text FROM "KnockoutPredictionScore") AS "knockoutScores",
      (SELECT COUNT(*)::text FROM "Prediction") AS "matchPredictions",
      (SELECT COUNT(*)::text FROM "KnockoutPick") AS "knockoutPicks",
      (SELECT COUNT(*)::text FROM "KnockoutGroupSimulationScore") AS "knockoutGroupSimulations"
  `);

  const totalsResult = await client.query(`
    WITH all_scores AS (
      SELECT "userId", "points", "scoreType"::text AS "scoreType", "isFinal"
      FROM "PredictionScore"
      UNION ALL
      SELECT "userId", "points", "scoreType"::text AS "scoreType", "isFinal"
      FROM "KnockoutPredictionScore"
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
  `);

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

    const snapshot = await createSnapshot(client);
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
