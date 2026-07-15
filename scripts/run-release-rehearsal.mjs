import 'dotenv/config';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates');
const backupDir = path.join(outputDir, 'sanitized-backup');
const avatarDir = path.join(root, 'apps', 'api', 'src', '__fixtures__', 'avatars');
const sourceUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('Configure TEST_DATABASE_URL ou DATABASE_URL.');

const sourceName = `bolao_stage9_sanitized_${process.pid}`.slice(0, 63);
const restoreName = `bolao_restore_verify_stage9_${process.pid}`.slice(0, 63);
const startedAt = Date.now();
let status = 'failed';

function databaseUrl(name, schema = true) {
  const url = new URL(sourceUrl);
  url.pathname = `/${name}`;
  url.search = schema ? '?schema=public' : '';
  return url.toString();
}

const maintenance = databaseUrl('postgres', false);
const sourceDatabaseUrl = databaseUrl(sourceName);
const restoreDatabaseUrl = databaseUrl(restoreName);

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    let executable = command;
    let executableArgs = args;
    if (command === 'npm') {
      if (!process.env.npm_execpath)
        throw new Error('npm_execpath nÃ£o estÃ¡ disponÃ­vel para o ensaio.');
      executable = process.execPath;
      executableArgs = [process.env.npm_execpath, ...args];
    } else if (command === 'npx' && args[0] === 'prisma') {
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
      code === 0 ? resolve() : reject(new Error(`${command} terminou com ${code}`)),
    );
  });
}

function snapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

await mkdir(backupDir, { recursive: true });
const admin = new Client({
  connectionString: maintenance,
  application_name: 'stage9-rehearsal-admin',
});
await admin.connect();
try {
  for (const name of [restoreName, sourceName]) {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
      name,
    ]);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await admin.query(`CREATE DATABASE "${sourceName}"`);
  await run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], {
    DATABASE_URL: sourceDatabaseUrl,
  });
  await run('npm', ['run', 'backfill:world-cup-2026'], { DATABASE_URL: sourceDatabaseUrl });

  const source = new Client({
    connectionString: sourceDatabaseUrl,
    application_name: 'stage9-sanitized-seed',
  });
  await source.connect();
  await source.query(`
    INSERT INTO "User" (id, username, "usernameLower", nickname, "passwordHash", role, status, "updatedAt")
    VALUES ('stage9-sanitized-user', 'stage9-fixture', 'stage9-fixture', 'Fixture Sanitizada', 'not-a-real-password-hash', 'USER', 'ACTIVE', now());
    INSERT INTO "Competition" (id, slug, name, "updatedAt") VALUES ('competition-stage9-canary', 'stage9-canary', 'Canário fixture', now());
    INSERT INTO "CompetitionSeason" (id, "competitionId", slug, name, timezone, status, "updatedAt") VALUES ('season-stage9-canary', 'competition-stage9-canary', 'stage9-canary-2026', 'Canário 2026 fixture', 'America/Sao_Paulo', 'ACTIVE', now());
    INSERT INTO "AppSetting" (key, value, "updatedAt") VALUES ('competition-features:season-stage9-canary', '{"readEnabled":true,"writeEnabled":true,"uiEnabled":true,"reason":"Fixture sanitizada para ensaio","updatedAt":"2026-07-15T12:00:00.000Z","updatedById":null}', now());
  `);
  await source.end();

  const beforeFile = path.join(outputDir, 'copa-before-rehearsal.json');
  const afterFile = path.join(outputDir, 'copa-after-migration.json');
  const rollbackFile = path.join(outputDir, 'copa-after-rollback.json');
  const backupScript = path.join(root, 'scripts', 'backup-postgres.ps1');
  const restoreScript = path.join(root, 'scripts', 'restore-postgres.ps1');
  await run('node', ['scripts/copa-snapshot.mjs', '--output', beforeFile], {
    SNAPSHOT_DATABASE_URL: sourceDatabaseUrl,
  });
  const powershell = process.platform === 'win32' ? 'powershell' : 'pwsh';
  await run(powershell, [
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    backupScript,
    '-DatabaseUrl',
    sourceDatabaseUrl,
    '-BackupDir',
    backupDir,
    '-AvatarDir',
    avatarDir,
  ]);
  const backupFile = (await readdir(backupDir))
    .filter((name) => name.endsWith('.dump'))
    .sort()
    .at(-1);
  if (!backupFile) throw new Error('O backup sanitizado não foi criado.');
  const backupPath = path.join(backupDir, backupFile);
  const avatarArchive = path.join(backupDir, `${path.basename(backupFile, '.dump')}.avatars.zip`);
  const avatarRestoreDir = path.join(backupDir, 'restored-avatars');

  await run(powershell, [
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    restoreScript,
    '-BackupFile',
    backupPath,
    '-MaintenanceDatabaseUrl',
    maintenance,
    '-TempDatabaseName',
    restoreName,
    '-ExpectedSnapshot',
    beforeFile,
    '-VerificationSnapshotFile',
    path.join(outputDir, 'copa-restored.json'),
    '-AvatarArchive',
    avatarArchive,
    '-AvatarVerificationDir',
    avatarRestoreDir,
    '-KeepTemporaryDatabase',
    '-KeepAvatarVerificationDir',
  ]);
  await run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], {
    DATABASE_URL: restoreDatabaseUrl,
  });
  await run('npm', ['run', 'backfill:world-cup-2026', '--', '--dry-run'], {
    DATABASE_URL: restoreDatabaseUrl,
  });
  await run('node', ['scripts/copa-snapshot.mjs', '--output', afterFile], {
    SNAPSHOT_DATABASE_URL: restoreDatabaseUrl,
  });
  await run('node', ['scripts/compare-copa-snapshots.mjs', beforeFile, afterFile]);

  const restored = new Client({
    connectionString: restoreDatabaseUrl,
    application_name: 'stage9-rollback',
  });
  await restored.connect();
  await restored.query(
    `UPDATE "AppSetting" SET value = jsonb_build_object('readEnabled', false, 'writeEnabled', false, 'uiEnabled', false, 'reason', 'Rollback ensaiado com fixture sanitizada', 'updatedAt', '2026-07-15T12:05:00.000Z', 'updatedById', NULL), "updatedAt" = now() WHERE key = 'competition-features:season-stage9-canary'`,
  );
  const flags = await restored.query(
    `SELECT value FROM "AppSetting" WHERE key = 'competition-features:season-stage9-canary'`,
  );
  await restored.end();
  if (
    flags.rows[0]?.value?.readEnabled !== false ||
    flags.rows[0]?.value?.writeEnabled !== false ||
    flags.rows[0]?.value?.uiEnabled !== false
  )
    throw new Error('Rollback por flags não desligou todos os caminhos.');
  await run('node', ['scripts/copa-snapshot.mjs', '--output', rollbackFile], {
    SNAPSHOT_DATABASE_URL: restoreDatabaseUrl,
  });
  await run('node', ['scripts/compare-copa-snapshots.mjs', afterFile, rollbackFile]);

  const before = JSON.parse(await readFile(beforeFile, 'utf8'));
  const after = JSON.parse(await readFile(afterFile, 'utf8'));
  status = 'passed';
  await writeFile(
    path.join(outputDir, 'migration-restore-rollback.json'),
    `${JSON.stringify({ formatVersion: 1, suite: 'migration-restore-rollback', status, durationMs: Date.now() - startedAt, pii: false, backup: 'sanitized-local-fixture', avatarsRestored: true, migrationApplied: true, rollbackFlags: { readEnabled: false, writeEnabled: false, uiEnabled: false }, copaHashBefore: snapshotHash(before), copaHashAfter: snapshotHash(after), copaContentHashesPreserved: JSON.stringify(before.contentHashes) === JSON.stringify(after.contentHashes) }, null, 2)}\n`,
  );
} finally {
  for (const name of [restoreName, sourceName]) {
    await admin
      .query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [name])
      .catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`).catch(() => undefined);
  }
  await admin.end();
  await rm(path.join(backupDir, 'restored-avatars'), { recursive: true, force: true });
}

if (status !== 'passed') process.exitCode = 1;
