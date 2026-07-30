import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const releaseWorkflow = await readFile(
  path.join(root, '.github', 'workflows', 'release-gates.yml'),
  'utf8',
);
const deployWorkflow = await readFile(
  path.join(root, '.github', 'workflows', 'deploy-production.yml'),
  'utf8',
);
const manifestGenerator = await readFile(
  path.join(root, 'scripts', 'generate-release-manifest.mjs'),
  'utf8',
);

test('main release gate always rehearses migrations and publishes a SHA-bound candidate', () => {
  assert.match(
    releaseWorkflow,
    /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(releaseWorkflow, /needs: \[release-candidate, migration\]/);
  assert.match(releaseWorkflow, /name: production-candidate-\$\{\{ github\.sha \}\}/);
  assert.match(releaseWorkflow, /node scripts\/generate-release-manifest\.mjs/);
  assert.match(releaseWorkflow, /postgres:\s*\n\s*image: postgres:18/);
  assert.match(manifestGenerator, /\['status', '--porcelain', '--untracked-files=all'\]/);
  assert.match(manifestGenerator, /requires a clean, immutable checkout/);
});

test('production workflow only accepts the exact successful main push', () => {
  assert.match(deployWorkflow, /workflow_run:/);
  assert.doesNotMatch(deployWorkflow, /^\s+pull_request:/m);
  assert.match(deployWorkflow, /workflow_run\.conclusion == 'success'/);
  assert.match(deployWorkflow, /workflow_run\.event == 'push'/);
  assert.match(deployWorkflow, /workflow_run\.head_branch == 'main'/);
  assert.match(deployWorkflow, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(deployWorkflow, /refs\/remotes\/origin\/main/);
  assert.match(deployWorkflow, /git ls-remote origin refs\/heads\/main/g);
  assert.match(deployWorkflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
});

test('only the dedicated Windows runner can mutate production', () => {
  const runnerMatches = deployWorkflow.match(
    /runs-on: \[self-hosted, Windows, X64, bolao-production\]/g,
  );
  assert.equal(runnerMatches?.length, 3);
  assert.match(deployWorkflow, /environment: production\s/);
  assert.match(deployWorkflow, /environment: production-migration/);
  assert.match(deployWorkflow, /-AllowMigration/);
  assert.match(deployWorkflow, /AUTO_DEPLOY|auto_deploy_enabled/);
  assert.match(
    deployWorkflow,
    /inspect-production:\s[\s\S]*if: needs\.deployment-enabled\.outputs\.enabled == 'true'/,
  );
  const environmentKillSwitches = deployWorkflow.match(
    /AUTO_DEPLOY_ENABLED: \$\{\{ vars\.AUTO_DEPLOY_ENABLED \}\}/g,
  );
  assert.equal(environmentKillSwitches?.length, 4);
  assert.match(
    deployWorkflow,
    /environment: production-migration[\s\S]*AUTO_DEPLOY_ENABLED precisa estar true no environment production-migration/,
  );
});

test('deployment is serialized and uses least-privilege immutable actions', () => {
  assert.match(deployWorkflow, /cancel-in-progress: false/);
  assert.match(deployWorkflow, /permissions:\s*\n\s*actions: read\s*\n\s*contents: read/);
  assert.doesNotMatch(deployWorkflow, /@[vV]\d/);
  assert.doesNotMatch(releaseWorkflow, /@[vV]\d/);

  const productionCheckouts = deployWorkflow.match(/persist-credentials: false/g);
  assert.equal(productionCheckouts?.length, 4);
  const pinnedNodeSetups = deployWorkflow.match(
    /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/g,
  );
  assert.equal(pinnedNodeSetups?.length, 4);
});

test('manifest validation covers the lockfile, schema and all migration files', () => {
  assert.match(deployWorkflow, /manifestSha256/);
  assert.match(deployWorkflow, /JSON\.stringify\(payload\)/);
  assert.match(deployWorkflow, /\.gitattributes/);
  assert.match(deployWorkflow, /package-lock\.json/);
  assert.match(deployWorkflow, /apps\/api\/prisma\/schema\.prisma/);
  assert.match(deployWorkflow, /apps\/api\/prisma\/migrations/);
  assert.match(deployWorkflow, /\.github\/workflows\/deploy-production\.yml/);
  assert.match(deployWorkflow, /ecosystem\.config\.cjs/);
  assert.match(deployWorkflow, /scripts\/deployment/);
  assert.match(deployWorkflow, /spawnSync\("git", \["show"/);
  assert.match(manifestGenerator, /\.gitattributes/);
  assert.match(manifestGenerator, /\['show', `HEAD:\$\{normalizedPath\}`\]/);
  assert.match(manifestGenerator, /\.github\/workflows\/deploy-production\.yml/);
  assert.match(manifestGenerator, /ecosystem\.config\.cjs/);
  assert.match(manifestGenerator, /scripts', 'deployment/);
});
