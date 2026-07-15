import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates');

function runAudit(args) {
  return new Promise((resolve, reject) => {
    if (!process.env.npm_execpath) {
      reject(new Error('npm_execpath is unavailable. Run this script through npm.'));
      return;
    }
    const child = spawn(process.execPath, [process.env.npm_execpath, 'audit', '--json', ...args], {
      cwd: root,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      try {
        resolve({ code, report: JSON.parse(stdout), stderr: stderr.trim() });
      } catch {
        reject(new Error(`npm audit did not return JSON (exit ${code}): ${stderr.slice(0, 500)}`));
      }
    });
  });
}

function summarize(scope, result) {
  const counts = result.report.metadata?.vulnerabilities ?? {};
  const actionable = Object.values(result.report.vulnerabilities ?? {})
    .filter((item) => ['high', 'critical'].includes(item.severity))
    .map((item) => ({ name: item.name, severity: item.severity, direct: item.isDirect }));
  return {
    scope,
    status: actionable.length === 0 ? 'passed' : 'failed',
    counts: {
      info: counts.info ?? 0,
      low: counts.low ?? 0,
      moderate: counts.moderate ?? 0,
      high: counts.high ?? 0,
      critical: counts.critical ?? 0,
      total: counts.total ?? 0,
    },
    actionable,
  };
}

const [productionResult, completeResult] = await Promise.all([
  runAudit(['--omit=dev']),
  runAudit([]),
]);
const scopes = [summarize('production', productionResult), summarize('complete', completeResult)];
const status = scopes.every((scope) => scope.status === 'passed') ? 'passed' : 'failed';
await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, 'dependency-audit.json'),
  `${JSON.stringify(
    {
      formatVersion: 1,
      suite: 'dependency-audit',
      status,
      pii: false,
      generatedAt: new Date().toISOString(),
      policy: 'No high or critical vulnerability in production or development dependency trees.',
      scopes,
    },
    null,
    2,
  )}\n`,
);
for (const scope of scopes) {
  process.stdout.write(`${scope.scope}: ${JSON.stringify(scope.counts)}\n`);
}
if (status !== 'passed') process.exitCode = 1;
