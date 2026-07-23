import 'dotenv/config';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates', 'prompt10-cups-2026');
const sourceUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const backupFile = process.env.PROMPT10_BACKUP_FILE
  ? path.resolve(process.env.PROMPT10_BACKUP_FILE)
  : null;
const expectedSnapshot = process.env.PROMPT10_EXPECTED_SNAPSHOT
  ? path.resolve(process.env.PROMPT10_EXPECTED_SNAPSHOT)
  : path.join(root, 'output', 'release-gates', 'prompt10-active-before.json');
const databaseName = `bolao_restore_verify_cups_${process.pid}_${Date.now()}`.slice(0, 63);
const avatarVerificationDir = backupFile ? `${backupFile}.prompt10-avatars` : null;
const restoreSnapshot = path.join(outputDir, 'restored-before-migrations.json');
const migratedSnapshot = path.join(outputDir, 'restored-after-migrations.json');
const loadedSnapshot = path.join(outputDir, 'restored-after-loads.json');
const reportFile = path.join(outputDir, 'canary-report.json');

if (!sourceUrl) throw new Error('Configure TEST_DATABASE_URL ou DATABASE_URL.');
if (!backupFile) throw new Error('Configure PROMPT10_BACKUP_FILE com o dump validado.');
if (!/^bolao_restore_verify_[a-z0-9_]+$/i.test(databaseName)) {
  throw new Error('Nome inseguro para o banco temporário.');
}

const source = new URL(sourceUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(source.hostname)) {
  throw new Error('O canário do Prompt 10 aceita somente PostgreSQL local de teste.');
}
const backupsRoot = path.join(root, 'backups') + path.sep;
if (
  !backupFile.startsWith(backupsRoot) ||
  path.extname(backupFile).toLowerCase() !== '.dump'
) {
  throw new Error('O dump deve estar dentro do diretório local backups e usar extensão .dump.');
}

function databaseUrl(name, includeSchema = true) {
  const url = new URL(sourceUrl);
  url.pathname = `/${name}`;
  url.search = includeSchema ? '?schema=public' : '';
  return url.toString();
}

const maintenanceUrl = databaseUrl('postgres', false);
const isolatedUrl = databaseUrl(databaseName);
const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: isolatedUrl,
  TEST_DATABASE_URL: isolatedUrl,
};

function executable(command, args) {
  if (command !== 'npm') return { command, args };
  if (!process.env.npm_execpath) {
    throw new Error('Execute o canário pelo script npm para localizar o CLI com segurança.');
  }
  return {
    command: process.execPath,
    args: [process.env.npm_execpath, ...args],
  };
}

function run(command, args, options = {}) {
  const resolved = executable(command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(resolved.command, resolved.args, {
      cwd: root,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    const stdout = [];
    const stderr = [];
    if (options.capture) {
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
    }
    child.once('error', reject);
    child.once('exit', (code) => {
      void (async () => {
        const output = Buffer.concat(stdout).toString('utf8');
        const errors = Buffer.concat(stderr).toString('utf8');
        if (options.captureFile) {
          await writeFile(options.captureFile, `${output}${errors}`, 'utf8');
        }
        if (code !== 0) {
          throw new Error(`${options.label ?? command} terminou com ${code}.`);
        }
        if (options.label) process.stdout.write(`PASS: ${options.label}\n`);
        return output;
      })().then(resolve, reject);
    });
  });
}

function parsedCommandJson(output, label) {
  const start = output.indexOf('{');
  if (start === -1) throw new Error(`${label} não produziu JSON.`);
  try {
    return JSON.parse(output.slice(start));
  } catch {
    throw new Error(`${label} produziu JSON inválido.`);
  }
}

function hashRows(rows) {
  const hash = createHash('sha256');
  for (const row of rows.map((item) => item.row).sort()) {
    hash.update(row);
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function protectedSeasonHashes(client) {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('A captura de hashes protegidos não está somente leitura.');
    }
    const seasons = await client.query(`
      SELECT season."id", competition."slug" AS "competitionSlug"
      FROM "CompetitionSeason" season
      JOIN "Competition" competition ON competition."id" = season."competitionId"
      WHERE season."id" = 'competition-season-world-cup-2026'
         OR season."slug" = 'brasileirao-serie-a-2026'
      ORDER BY competition."slug"
    `);
    if (seasons.rows.length !== 2) {
      throw new Error(
        `A baseline exige Copa e Brasileirão não vazios; encontrou ${seasons.rows.length}.`,
      );
    }
    const filters = {
      Match: 'source_row."seasonId" = $1',
      Prediction: 'source_row."matchId" IN (SELECT "id" FROM "Match" WHERE "seasonId" = $1)',
      PredictionScore:
        'source_row."matchId" IN (SELECT "id" FROM "Match" WHERE "seasonId" = $1)',
      RankingSnapshot: 'source_row."seasonId" = $1',
    };
    const hashes = {};
    for (const season of seasons.rows) {
      const scope = {};
      for (const [table, filter] of Object.entries(filters)) {
        const ignored =
          table === 'Match'
            ? [
                'tieId',
                'legNumber',
                'regulationHomeScore',
                'regulationAwayScore',
                'extraTimeHomeScore',
                'extraTimeAwayScore',
                'penaltyHomeScore',
                'penaltyAwayScore',
                'venueName',
                'venueCity',
                'venueCountryCode',
              ]
            : [];
        const rows = await client.query(
          `SELECT (to_jsonb(source_row) - $2::text[])::text AS row
           FROM "${table}" source_row WHERE ${filter}`,
          [season.id, ignored],
        );
        scope[table] = { count: rows.rowCount, sha256: hashRows(rows.rows) };
      }
      hashes[season.competitionSlug] = scope;
    }
    await client.query('COMMIT');
    return hashes;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function cupState(client) {
  const seasons = await client.query(`
    SELECT season."id", season."slug", season."status",
           pool_season."id" AS "poolSeasonId",
           to_char(
             pool_season."scoreableFrom",
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ) AS "scoreableFrom",
           pool_season."historicalMatchesScoreable",
           setting.value AS flags
    FROM "CompetitionSeason" season
    LEFT JOIN LATERAL (
      SELECT value
      FROM "AppSetting"
      WHERE key = 'competition-features:' || season.id
    ) setting ON true
    LEFT JOIN LATERAL (
      SELECT "id", "scoreableFrom", "historicalMatchesScoreable"
      FROM "PoolSeason"
      WHERE "seasonId" = season.id
      ORDER BY "id"
      LIMIT 1
    ) pool_season ON true
    WHERE season."slug" IN (
      'conmebol-sudamericana-2026',
      'conmebol-libertadores-2026',
      'copa-do-brasil-2026'
    )
    ORDER BY season."slug"
  `);
  const state = [];
  for (const season of seasons.rows) {
    const counts = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM "SeasonTeam" WHERE "seasonId" = $1) AS teams,
        (SELECT COUNT(*)::int FROM "Stage" WHERE "seasonId" = $1) AS stages,
        (SELECT COUNT(*)::int FROM "Round" WHERE "seasonId" = $1) AS rounds,
        (SELECT COUNT(*)::int FROM "Tie" WHERE "seasonId" = $1) AS ties,
        (SELECT COUNT(*)::int FROM "Match" WHERE "seasonId" = $1) AS matches,
        (SELECT COUNT(*)::int FROM "PredictionScore" score
          JOIN "Match" match ON match.id = score."matchId"
          WHERE match."seasonId" = $1) AS scores,
        (SELECT COUNT(*)::int FROM "SyncQuarantine"
          WHERE "seasonId" = $1 AND "resolvedAt" IS NULL) AS quarantines,
        (SELECT COUNT(*)::int FROM "ProviderSyncRun" WHERE "seasonId" = $1) AS "syncRuns"`,
      [season.id],
    );
    state.push({ ...season, ...counts.rows[0] });
  }
  return state;
}

function assertClosedCups(state) {
  if (state.length !== 3) throw new Error(`Esperadas três copas; encontradas ${state.length}.`);
  for (const season of state) {
    const flags = season.flags;
    if (
      season.status !== 'DRAFT' ||
      !flags ||
      flags.readEnabled !== false ||
      flags.writeEnabled !== false ||
      flags.uiEnabled !== false ||
      flags.syncEnabled !== false ||
      season.quarantines !== 0 ||
      season.scores !== 0
    ) {
      throw new Error(`Canário administrativo inválido para ${season.slug}.`);
    }
  }
}

async function capture(label, script, args) {
  const file = path.join(outputDir, `${label}.log`);
  const output = await run('npm', ['run', script, '--', ...args], {
    env: testEnvironment,
    capture: true,
    captureFile: file,
    label,
  });
  return parsedCommandJson(output, label);
}

await access(backupFile);
await access(`${backupFile}.metadata.json`);
await access(expectedSnapshot);
await mkdir(outputDir, { recursive: true });

const sourceClient = new Client({
  connectionString: sourceUrl,
  application_name: 'prompt10-source-hashes',
});
await sourceClient.connect();
const sourceHashes = await protectedSeasonHashes(sourceClient);
await sourceClient.end();

const powershell = process.platform === 'win32' ? 'powershell' : 'pwsh';
const restoreScript = path.join(root, 'scripts', 'restore-postgres.ps1');
const admin = new Client({
  connectionString: maintenanceUrl,
  application_name: 'prompt10-test-canary-admin',
});
let isolatedClient = null;
const startedAt = new Date();

await admin.connect();
try {
  await run(
    powershell,
    [
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      restoreScript,
      '-BackupFile',
      backupFile,
      '-MaintenanceDatabaseUrl',
      maintenanceUrl,
      '-TempDatabaseName',
      databaseName,
      '-ExpectedSnapshot',
      expectedSnapshot,
      '-VerificationSnapshotFile',
      restoreSnapshot,
      '-AvatarVerificationDir',
      avatarVerificationDir,
      '-KeepTemporaryDatabase',
      '-KeepAvatarVerificationDir',
    ],
    { env: { NODE_ENV: 'test' } },
  );

  await run('npm', ['--workspace', '@bolao/api', 'exec', '--', 'prisma', 'migrate', 'status'], {
    env: testEnvironment,
    capture: true,
    captureFile: path.join(outputDir, 'migrate-status-before.log'),
    label: 'migrate-status-before',
  }).catch((error) => {
    if (!error.message.includes('terminou com 1')) throw error;
    process.stdout.write('PASS: migrate-status-before detectou migrations pendentes\n');
  });
  await run(
    'npm',
    ['--workspace', '@bolao/api', 'exec', '--', 'prisma', 'migrate', 'deploy'],
    {
      env: testEnvironment,
      capture: true,
      captureFile: path.join(outputDir, 'migrate-deploy.log'),
      label: 'migrate-deploy',
    },
  );
  await run('npm', ['--workspace', '@bolao/api', 'exec', '--', 'prisma', 'migrate', 'status'], {
    env: testEnvironment,
    capture: true,
    captureFile: path.join(outputDir, 'migrate-status-after.log'),
    label: 'migrate-status-after',
  });
  await run('node', ['scripts/verify-multi-competition-db.mjs'], {
    env: { ...testEnvironment, MIGRATION_TEST_DATABASE_URL: isolatedUrl },
    capture: true,
    captureFile: path.join(outputDir, 'migration-constraints.log'),
    label: 'migration-constraints',
  });
  await run('npm', ['run', 'backfill:world-cup-2026', '--', '--dry-run'], {
    env: testEnvironment,
    capture: true,
    captureFile: path.join(outputDir, 'backfill-dry-run.log'),
    label: 'backfill-dry-run',
  });
  await run(
    'node',
    ['scripts/copa-snapshot.mjs', '--backfill', '--output', migratedSnapshot],
    {
      env: { ...testEnvironment, SNAPSHOT_DATABASE_URL: isolatedUrl },
      capture: true,
      captureFile: path.join(outputDir, 'snapshot-after-migrations.log'),
      label: 'snapshot-after-migrations',
    },
  );
  await run(
    'node',
    ['scripts/compare-copa-snapshots.mjs', '--backfill', expectedSnapshot, migratedSnapshot],
    {
      capture: true,
      captureFile: path.join(outputDir, 'snapshot-migration-compare.log'),
      label: 'snapshot-migration-compare',
    },
  );

  isolatedClient = new Client({
    connectionString: isolatedUrl,
    application_name: 'prompt10-test-canary',
  });
  await isolatedClient.connect();
  const restoredProtectedHashes = await protectedSeasonHashes(isolatedClient);

  const dryRuns = {
    sudamericana: await capture(
      'sudamericana-dry-run',
      'load:sudamericana-2026',
      ['--dry-run'],
    ),
    libertadores: await capture(
      'libertadores-dry-run',
      'load:libertadores-2026',
      ['--dry-run'],
    ),
    copaDoBrasil: await capture(
      'copa-do-brasil-dry-run',
      'load:copa-do-brasil-2026',
      ['--dry-run'],
    ),
  };
  const firstApply = {
    sudamericana: await capture(
      'sudamericana-apply',
      'load:sudamericana-2026',
      ['--apply'],
    ),
    libertadores: await capture(
      'libertadores-apply',
      'load:libertadores-2026',
      ['--apply'],
    ),
    copaDoBrasil: await capture(
      'copa-do-brasil-apply',
      'load:copa-do-brasil-2026',
      ['--apply'],
    ),
  };

  const stateBeforeRepeat = await cupState(isolatedClient);
  assertClosedCups(stateBeforeRepeat);

  await capture('sudamericana-apply-repeat', 'load:sudamericana-2026', ['--apply']);
  await capture('libertadores-apply-repeat', 'load:libertadores-2026', ['--apply']);
  await capture('copa-do-brasil-apply-repeat', 'load:copa-do-brasil-2026', ['--apply']);
  const stateAfterRepeat = await cupState(isolatedClient);
  if (JSON.stringify(stateBeforeRepeat) !== JSON.stringify(stateAfterRepeat)) {
    throw new Error('A repetição das cargas alterou contagens, flags ou execuções persistidas.');
  }

  const verifies = {
    sudamericana: await capture(
      'sudamericana-verify',
      'load:sudamericana-2026',
      ['--verify'],
    ),
    libertadores: await capture(
      'libertadores-verify',
      'load:libertadores-2026',
      ['--verify'],
    ),
    copaDoBrasil: await capture(
      'copa-do-brasil-verify',
      'load:copa-do-brasil-2026',
      ['--verify'],
    ),
  };
  const verifyRuns = Object.values(verifies).flatMap((result) => result.runs ?? []);
  if (
    verifyRuns.some(
      (run) =>
        run.counts?.inserted !== 0 ||
        run.counts?.updated !== 0 ||
        run.counts?.quarantined !== 0,
    )
  ) {
    throw new Error('VERIFY detectou escrita ou quarentena após a repetição idempotente.');
  }

  await capture(
    'sudamericana-reconciliation',
    'reconcile:sudamericana-2026',
    ['--verify-db'],
  );
  await capture(
    'libertadores-reconciliation',
    'reconcile:libertadores-2026',
    ['--verify-db', `--output=${path.join(outputDir, 'libertadores-reconciliation.json')}`],
  );
  await capture(
    'copa-do-brasil-reconciliation',
    'reconcile:copa-do-brasil-2026',
    ['--verify'],
  );

  const finalState = await cupState(isolatedClient);
  assertClosedCups(finalState);
  const finalProtectedHashes = await protectedSeasonHashes(isolatedClient);
  if (JSON.stringify(restoredProtectedHashes) !== JSON.stringify(finalProtectedHashes)) {
    throw new Error('Cargas das copas alteraram hashes protegidos da Copa/Brasileirão.');
  }
  await run(
    'node',
    ['scripts/copa-snapshot.mjs', '--backfill', '--output', loadedSnapshot],
    {
      env: { ...testEnvironment, SNAPSHOT_DATABASE_URL: isolatedUrl },
      capture: true,
      captureFile: path.join(outputDir, 'snapshot-after-loads.log'),
      label: 'snapshot-after-loads',
    },
  );
  await run(
    'node',
    ['scripts/compare-copa-snapshots.mjs', '--backfill', expectedSnapshot, loadedSnapshot],
    {
      capture: true,
      captureFile: path.join(outputDir, 'snapshot-load-compare.log'),
      label: 'snapshot-load-compare',
    },
  );

  const report = {
    formatVersion: 1,
    suite: 'cups-2026-test-canary',
    status: 'passed',
    environment: 'test-local-isolated-restore',
    productionTouched: false,
    syntheticOfficialDataWritten: false,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    backup: {
      fileName: path.basename(backupFile),
      manifestValidated: true,
      restoreIsolated: true,
      avatarsRestored: true,
    },
    migrations: {
      statusBeforeCaptured: true,
      deployCommand: 'npm --workspace @bolao/api exec -- prisma migrate deploy',
      statusAfter: 'up-to-date',
      constraints: 'passed',
    },
    protectedSeasonHashes: {
      sourceAtRun: sourceHashes,
      restoredBeforeLoads: restoredProtectedHashes,
      restoredAfterLoads: finalProtectedHashes,
      restoredCopyPreserved:
        JSON.stringify(restoredProtectedHashes) === JSON.stringify(finalProtectedHashes),
      sourceStillMatchedBackup:
        JSON.stringify(sourceHashes) === JSON.stringify(restoredProtectedHashes),
    },
    sourceChecksums: Object.fromEntries(
      Object.entries(dryRuns).map(([key, result]) => [key, result.evidence?.checksum]),
    ),
    firstApply: Object.fromEntries(
      Object.entries(firstApply).map(([key, result]) => [
        key,
        {
          readiness: result.readiness,
          runs: result.runs?.map((run) => ({
            type: run.type,
            status: run.status,
            checksum: run.checksum,
            counts: run.counts,
          })),
        },
      ]),
    ),
    idempotency: {
      repeatedWithSameKeys: true,
      stateUnchanged: true,
      verifyWithDistinctModeKeys: true,
      verifyWrites: 0,
      verifyQuarantines: 0,
    },
    canary: {
      kind: 'administrative',
      flagsStayedClosed: true,
      publicWriteAttempted: false,
      officialSyntheticPredictionWritten: false,
      state: finalState,
    },
    artifactsContainSecrets: false,
  };
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`PASS: canário isolado registrado em ${reportFile}\n`);
} finally {
  if (isolatedClient) await isolatedClient.end().catch(() => undefined);
  const temporaryDatabase = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [databaseName],
  );
  if (temporaryDatabase.rowCount === 1) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
      databaseName,
    ]);
    await admin.query(`DROP DATABASE "${databaseName}"`);
    process.stdout.write(`Banco temporário removido: ${databaseName}\n`);
  }
  await admin.end();
  if (avatarVerificationDir) {
    const resolved = path.resolve(avatarVerificationDir);
    const backupParent = path.dirname(backupFile) + path.sep;
    if (!resolved.startsWith(backupParent)) {
      throw new Error('Diretório temporário de avatares fora do diretório do backup.');
    }
    await rm(resolved, { recursive: true, force: true });
  }
}
