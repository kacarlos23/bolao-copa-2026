import 'dotenv/config';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const { Client } = pg;
const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates');

function sanitizedUrl(databaseUrl, databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

function maintenanceUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    let executable = command;
    let executableArgs = args;
    if (command === 'npm') {
      if (!process.env.npm_execpath) throw new Error('npm_execpath is unavailable.');
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

const sourceUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!sourceUrl)
  throw new Error('Configure TEST_DATABASE_URL ou DATABASE_URL para PostgreSQL real.');

const databaseName = `bolao_stage9_${process.pid}_${Date.now()}`.slice(0, 63);
const databaseUrl = sanitizedUrl(sourceUrl, databaseName);
const admin = new Client({
  connectionString: maintenanceUrl(sourceUrl),
  application_name: 'stage9-integration-admin',
});
const startedAt = Date.now();
let status = 'failed';

await mkdir(outputDir, { recursive: true });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await run('npx', ['prisma', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], {
    DATABASE_URL: databaseUrl,
  });
  await run('npm', ['run', 'backfill:world-cup-2026', '--', '--dry-run'], {
    DATABASE_URL: databaseUrl,
  });
  await run('npm', ['--workspace', '@bolao/api', 'run', 'test:integration:vitest'], {
    DATABASE_URL: databaseUrl,
  });
  status = 'passed';
} finally {
  await admin
    .query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [
      databaseName,
    ])
    .catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
  await admin.end();
  await writeFile(
    path.join(outputDir, 'postgres-integration.json'),
    `${JSON.stringify({ formatVersion: 1, suite: 'postgres-integration', status, durationMs: Date.now() - startedAt, database: 'ephemeral-sanitized', pii: false }, null, 2)}\n`,
  );
}

if (status !== 'passed') process.exitCode = 1;
