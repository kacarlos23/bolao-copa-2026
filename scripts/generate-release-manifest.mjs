import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fileHash(relativePath) {
  return {
    path: relativePath.replaceAll('\\', '/'),
    sha256: sha256(await readFile(path.join(root, relativePath))),
  };
}

async function migrationFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await migrationFiles(absolute, relative)));
    else files.push(relative);
  }
  return files;
}

const { stdout: statusOutput } = await exec(
  'git',
  ['status', '--porcelain', '--untracked-files=all'],
  { cwd: root },
);
if (statusOutput.trim()) {
  throw new Error('Release manifest requires a clean, immutable checkout.');
}
const { stdout: commitOutput } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
const commitSha = commitOutput.trim().toLowerCase();
if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error('Unable to resolve candidate commit SHA.');
const { stdout: tagsOutput } = await exec('git', ['tag', '--points-at', 'HEAD', '--list', 'rc-*'], {
  cwd: root,
});
const rcTags = tagsOutput.split(/\r?\n/).filter(Boolean).sort();
if (process.env.REQUIRE_RC_TAG === 'true' && rcTags.length === 0) {
  throw new Error('Tagged release gate requires an rc-* tag pointing to HEAD.');
}

const migrationRoot = path.join(root, 'apps', 'api', 'prisma', 'migrations');
const migrations = await migrationFiles(migrationRoot);
const files = await Promise.all([
  fileHash('package-lock.json'),
  fileHash('.github/workflows/release-gates.yml'),
  fileHash('apps/api/prisma/schema.prisma'),
  fileHash('apps/api/src/modules/providers/adapters/cbf-serie-a-2026.provider.ts'),
  ...migrations.map((file) => fileHash(path.join('apps', 'api', 'prisma', 'migrations', file))),
]);
const manifest = {
  formatVersion: 1,
  suite: 'release-candidate-manifest',
  status: 'passed',
  pii: false,
  generatedAt: new Date().toISOString(),
  commitSha,
  rcTags,
  files,
};
await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, 'release-candidate-manifest.json'),
  `${JSON.stringify({ ...manifest, manifestSha256: sha256(JSON.stringify(manifest)) }, null, 2)}\n`,
);
process.stdout.write(`Candidate ${commitSha} (${rcTags.join(', ') || 'untagged validation'})\n`);
