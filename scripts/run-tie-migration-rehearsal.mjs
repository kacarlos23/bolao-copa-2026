import 'dotenv/config';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.resolve(root, 'output', 'tie-migration-rehearsal');
const temporarySchemaDir = path.resolve(outputDir, 'pre-tie-prisma');
const dumpPath = path.resolve(outputDir, 'source-before-tie.dump');
const plainRestorePath = path.resolve(outputDir, 'source-before-tie.sql');
const beforeSnapshot = path.resolve(outputDir, 'copa-before-tie.json');
const afterSnapshot = path.resolve(outputDir, 'copa-after-tie.json');
const evidencePath = path.resolve(outputDir, 'tie-migration-rehearsal.json');
const sourceUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const configuredBackupPath = process.env.TIE_REHEARSAL_BACKUP_FILE
  ? path.resolve(process.env.TIE_REHEARSAL_BACKUP_FILE)
  : null;
const tieMigration = '20260721010000_add_generic_ties';
const databaseName = `bolao_tie_rehearsal_${process.pid}_${Date.now()}`.slice(0, 63);

if (!sourceUrl) throw new Error('Configure TEST_DATABASE_URL ou DATABASE_URL.');
if (!/^bolao_tie_rehearsal_[a-z0-9_]+$/i.test(databaseName)) {
  throw new Error('Nome inseguro para o banco temporário.');
}

function databaseUrl(name, includeSchema = true) {
  const url = new URL(sourceUrl);
  url.pathname = `/${name}`;
  url.search = includeSchema ? '?schema=public' : '';
  return url.toString();
}

function connectionArguments(urlValue, database = null) {
  const url = new URL(urlValue);
  return {
    host: url.hostname,
    port: url.port || '5432',
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: database ?? decodeURIComponent(url.pathname.slice(1)),
  };
}

async function resolvePostgresTool(name, configuredPath) {
  if (configuredPath) {
    await access(configuredPath);
    return configuredPath;
  }
  if (process.platform !== 'win32') return name;
  const programFiles = process.env.ProgramFiles;
  if (!programFiles) throw new Error(`Não foi possível localizar ${name}.`);
  const postgresRoot = path.join(programFiles, 'PostgreSQL');
  const versions = (await readdir(postgresRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => Number(right) - Number(left));
  for (const version of versions) {
    const candidate = path.join(postgresRoot, version, 'bin', `${name}.exe`);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed PostgreSQL version.
    }
  }
  throw new Error(`Não foi possível localizar ${name}.`);
}

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    let executable = command;
    let executableArgs = args;
    if (command === 'npx' && args[0] === 'prisma') {
      executable = process.execPath;
      executableArgs = [
        path.join(root, 'node_modules', 'prisma', 'build', 'index.js'),
        ...args.slice(1),
      ];
    }
    const child = spawn(executable, executableArgs, {
      cwd: root,
      env: { ...process.env, ...env },
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(command)} terminou com ${code}`)),
    );
  });
}

function sha256Rows(rows) {
  const hash = createHash('sha256');
  for (const row of rows.map((item) => item.row).sort()) {
    hash.update(row);
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function protectedSeasonHashes(client) {
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
      `O ensaio exige Copa e Brasileirão não vazios; encontrou ${seasons.rows.length} temporadas.`,
    );
  }

  const hashes = {};
  for (const season of seasons.rows) {
    const filters = {
      Match: 'source_row."seasonId" = $1',
      Prediction: 'source_row."matchId" IN (SELECT "id" FROM "Match" WHERE "seasonId" = $1)',
      PredictionScore: 'source_row."matchId" IN (SELECT "id" FROM "Match" WHERE "seasonId" = $1)',
      RankingSnapshot: 'source_row."seasonId" = $1',
    };
    const scope = {};
    for (const [tableName, filter] of Object.entries(filters)) {
      const ignored =
        tableName === 'Match'
          ? [
              'tieId',
              'legNumber',
              'regulationHomeScore',
              'regulationAwayScore',
              'extraTimeHomeScore',
              'extraTimeAwayScore',
              'penaltyHomeScore',
              'penaltyAwayScore',
            ]
          : [];
      const rows = await client.query(
        `SELECT (to_jsonb(source_row) - $2::text[])::text AS row
         FROM "${tableName}" source_row WHERE ${filter}`,
        [season.id, ignored],
      );
      scope[tableName] = { count: rows.rowCount, sha256: sha256Rows(rows.rows) };
    }
    hashes[season.competitionSlug] = scope;
  }
  return hashes;
}

async function copyPreTiePrismaSchema() {
  const sourcePrismaDir = path.resolve(root, 'apps', 'api', 'prisma');
  await rm(temporarySchemaDir, { recursive: true, force: true });
  await mkdir(path.join(temporarySchemaDir, 'migrations'), { recursive: true });
  await cp(
    path.join(sourcePrismaDir, 'schema.prisma'),
    path.join(temporarySchemaDir, 'schema.prisma'),
  );
  const migrationNames = await readdir(path.join(sourcePrismaDir, 'migrations'));
  for (const migrationName of migrationNames) {
    if (migrationName === tieMigration || migrationName === 'migration_lock.toml') continue;
    await cp(
      path.join(sourcePrismaDir, 'migrations', migrationName),
      path.join(temporarySchemaDir, 'migrations', migrationName),
      { recursive: true },
    );
  }
  await cp(
    path.join(sourcePrismaDir, 'migrations', 'migration_lock.toml'),
    path.join(temporarySchemaDir, 'migrations', 'migration_lock.toml'),
  ).catch(() => undefined);
}

await mkdir(outputDir, { recursive: true });
await copyPreTiePrismaSchema();
const sourceConnection = connectionArguments(sourceUrl);
const maintenanceUrl = databaseUrl('postgres', false);
const isolatedUrl = databaseUrl(databaseName);
const admin = new Client({
  connectionString: maintenanceUrl,
  application_name: 'tie-migration-rehearsal-admin',
});
const pgDump = await resolvePostgresTool('pg_dump', process.env.PG_DUMP_PATH);
const pgRestore = await resolvePostgresTool('pg_restore', process.env.PG_RESTORE_PATH);
const psql = await resolvePostgresTool('psql', process.env.PSQL_PATH);
let createdDatabase = false;
let status = 'failed';
let isolated = null;

await admin.connect();
try {
  if (!configuredBackupPath) {
    await run(
      pgDump,
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--file',
        dumpPath,
        '--host',
        sourceConnection.host,
        '--port',
        sourceConnection.port,
        '--username',
        sourceConnection.username,
        sourceConnection.database,
      ],
      { PGPASSWORD: sourceConnection.password },
    );
  } else {
    await access(configuredBackupPath);
  }
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  createdDatabase = true;
  const isolatedConnection = connectionArguments(isolatedUrl);
  const effectiveDumpPath = configuredBackupPath ?? dumpPath;
  if (process.env.TIE_REHEARSAL_PG18_DOCKER === '1') {
    await run('docker', [
      'run',
      '--rm',
      '--mount',
      `type=bind,source=${path.dirname(effectiveDumpPath)},target=/backup,readonly`,
      '--mount',
      `type=bind,source=${outputDir},target=/work`,
      'postgres:18',
      'pg_restore',
      '--no-owner',
      '--no-privileges',
      '--file=/work/source-before-tie.sql',
      `/backup/${path.basename(effectiveDumpPath)}`,
    ]);
    const restoreSql = await readFile(plainRestorePath, 'utf8');
    const compatibleSql = restoreSql.replace(/^SET transaction_timeout = 0;\r?\n/m, '');
    if (compatibleSql === restoreSql) {
      throw new Error('O dump PostgreSQL 18 não continha o SET de compatibilidade esperado.');
    }
    await writeFile(plainRestorePath, compatibleSql);
    await run(
      psql,
      [
        '--host',
        isolatedConnection.host,
        '--port',
        isolatedConnection.port,
        '--username',
        isolatedConnection.username,
        '--dbname',
        isolatedConnection.database,
        '--quiet',
        '--set',
        'ON_ERROR_STOP=1',
        '--file',
        plainRestorePath,
      ],
      { PGPASSWORD: isolatedConnection.password },
    );
  } else {
    await run(
      pgRestore,
      [
        '--exit-on-error',
        '--no-owner',
        '--no-privileges',
        '--host',
        isolatedConnection.host,
        '--port',
        isolatedConnection.port,
        '--username',
        isolatedConnection.username,
        '--dbname',
        isolatedConnection.database,
        effectiveDumpPath,
      ],
      { PGPASSWORD: isolatedConnection.password },
    );
  }
  await run(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', path.join(temporarySchemaDir, 'schema.prisma')],
    { DATABASE_URL: isolatedUrl },
  );

  isolated = new Client({
    connectionString: isolatedUrl,
    application_name: 'tie-migration-rehearsal',
  });
  isolated.on('error', () => undefined);
  await isolated.connect();
  const beforeHashes = await protectedSeasonHashes(isolated);
  await run('node', ['scripts/copa-snapshot.mjs', '--backfill', '--output', beforeSnapshot], {
    SNAPSHOT_DATABASE_URL: isolatedUrl,
  });
  await run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], {
    DATABASE_URL: isolatedUrl,
  });
  await run('node', ['scripts/verify-multi-competition-db.mjs'], {
    MIGRATION_TEST_DATABASE_URL: isolatedUrl,
  });
  const afterHashes = await protectedSeasonHashes(isolated);
  await run('node', ['scripts/copa-snapshot.mjs', '--backfill', '--output', afterSnapshot], {
    SNAPSHOT_DATABASE_URL: isolatedUrl,
  });
  await run('node', [
    'scripts/compare-copa-snapshots.mjs',
    '--backfill',
    beforeSnapshot,
    afterSnapshot,
  ]);

  if (JSON.stringify(beforeHashes) !== JSON.stringify(afterHashes)) {
    throw new Error('Hashes protegidos da Copa/Brasileirão divergiram após a migration Tie.');
  }
  const migrationResult = await isolated.query(
    'SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
    [tieMigration],
  );
  const tieResult = await isolated.query('SELECT COUNT(*)::int AS count FROM "Tie"');
  await isolated.end();
  isolated = null;
  if (migrationResult.rows[0]?.count !== 1)
    throw new Error('Migration Tie não foi aplicada uma vez.');
  if (tieResult.rows[0]?.count !== 0)
    throw new Error('Migration expand criou ties por backfill implícito.');

  status = 'passed';
  const before = JSON.parse(await readFile(beforeSnapshot, 'utf8'));
  const after = JSON.parse(await readFile(afterSnapshot, 'utf8'));
  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        formatVersion: 1,
        suite: 'tie-migration-rehearsal',
        status,
        source: 'restored-validated-backup',
        isolatedDatabase: true,
        destructiveMigrationOperations: 0,
        implicitTieBackfillRows: 0,
        protectedSeasonHashes: afterHashes,
        worldCupBusinessHashesPreserved:
          JSON.stringify(before.businessContentHashes) ===
          JSON.stringify(after.businessContentHashes),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (isolated) await isolated.end().catch(() => undefined);
  if (createdDatabase) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
      databaseName,
    ]);
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  await admin.end();
  if (!dumpPath.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error('Caminho inseguro para remover o dump temporário.');
  }
  if (!configuredBackupPath) await rm(dumpPath, { force: true });
  await rm(plainRestorePath, { force: true });
  await rm(temporarySchemaDir, { recursive: true, force: true });
}

if (status !== 'passed') process.exitCode = 1;
