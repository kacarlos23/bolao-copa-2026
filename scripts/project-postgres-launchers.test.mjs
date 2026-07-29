import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherPaths = [
  'scripts/start-project-postgres.ps1',
  'scripts/status-project-postgres.ps1',
  'scripts/stop-project-postgres.ps1',
  'scripts/check-start-project.ps1',
];

test('project PostgreSQL launchers resolve the cluster major and configured port', async () => {
  const common = await readFile('scripts/postgres-common.ps1', 'utf8');
  const launchers = await Promise.all(launcherPaths.map((file) => readFile(file, 'utf8')));

  assert.match(common, /function Get-PgClusterMajor/);
  assert.match(common, /function Resolve-ProjectPgBin/);
  assert.match(common, /function Get-ProjectPgPort/);

  for (const launcher of launchers) {
    assert.doesNotMatch(launcher, /PostgreSQL\\18\\bin/i);
    assert.match(launcher, /Resolve-ProjectPgBin/);
  }
  assert.doesNotMatch(launchers.join('\n'), /pg_isready\.exe"?\)?\s+-h localhost -p 5433/i);
});
