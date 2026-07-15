import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates');
const rounds = [];

function run(script) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    if (!process.env.npm_execpath) throw new Error('npm_execpath is unavailable.');
    const child = spawn(process.execPath, [process.env.npm_execpath, 'run', script], {
      cwd: root,
      shell: false,
      stdio: 'inherit',
      env: process.env,
    });
    child.once('exit', (code) =>
      resolve({ script, exitCode: code ?? 1, durationMs: Date.now() - startedAt }),
    );
  });
}

for (let round = 1; round <= 2; round += 1) {
  for (const script of ['test:contract', 'test:component'])
    rounds.push({ round, ...(await run(script)) });
}
const failed = rounds.filter((item) => item.exitCode !== 0);
const report = {
  formatVersion: 1,
  suite: 'critical-flakiness',
  status: failed.length ? 'failed' : 'passed',
  flakyBudget: 0,
  observedFlakes: failed.length,
  pii: false,
  rounds,
};
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'flakiness.json'), `${JSON.stringify(report, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
