import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates');
const lockfilePath = path.join(root, 'package-lock.json');
const waiverPath = path.join(root, 'docs', 'dependency-audit-waivers.json');
const severityOrder = ['info', 'low', 'moderate', 'high', 'critical'];

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

export function validateAuditResult(result) {
  if (!result || ![0, 1].includes(result.code)) {
    throw new Error(`npm audit failed operationally (exit ${result?.code ?? 'unknown'}).`);
  }
  if (result.report?.error) {
    const summary =
      result.report.error.summary ?? result.report.error.message ?? JSON.stringify(result.report.error);
    throw new Error(`npm audit returned an error: ${summary}`);
  }
  if (
    result.report?.auditReportVersion !== 2 ||
    !result.report.vulnerabilities ||
    typeof result.report.vulnerabilities !== 'object'
  ) {
    throw new Error('npm audit returned an unsupported report schema.');
  }
  const counts = result.report.metadata?.vulnerabilities;
  if (
    !counts ||
    severityOrder.some(
      (severity) => !Number.isInteger(counts[severity]) || counts[severity] < 0,
    ) ||
    !Number.isInteger(counts.total) ||
    counts.total < 0
  ) {
    throw new Error('npm audit returned invalid vulnerability counters.');
  }
}

export function validateWaiverDocument(document) {
  if (document?.version !== 1 || !Array.isArray(document.entries)) {
    throw new Error('Dependency audit waivers must use schema version 1.');
  }
  const ids = new Set();
  for (const entry of document.entries) {
    if (
      typeof entry?.id !== 'string' ||
      typeof entry.package !== 'string' ||
      !Array.isArray(entry.versions) ||
      entry.versions.length === 0 ||
      entry.versions.some((version) => typeof version !== 'string') ||
      typeof entry.reason !== 'string' ||
      typeof entry.owner !== 'string' ||
      typeof entry.source !== 'string' ||
      typeof entry.expiresOn !== 'string' ||
      Number.isNaN(Date.parse(`${entry.expiresOn}T23:59:59.999Z`))
    ) {
      throw new Error(`Invalid dependency audit waiver: ${entry?.id ?? 'unknown'}.`);
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate dependency audit waiver: ${entry.id}.`);
    ids.add(entry.id);
  }
  return document.entries;
}

function advisoryId(advisory) {
  if (typeof advisory?.url !== 'string') return null;
  return advisory.url.match(/\/advisories\/(GHSA-[a-z0-9-]+)$/i)?.[1]?.toUpperCase() ?? null;
}

function collectRootAdvisories(report, vulnerabilityName, stack = new Set()) {
  const item = report.vulnerabilities[vulnerabilityName];
  if (!item || stack.has(vulnerabilityName)) {
    return [{ unresolved: vulnerabilityName, severity: item?.severity ?? 'high' }];
  }
  const nextStack = new Set(stack).add(vulnerabilityName);
  const roots = [];
  for (const via of item.via ?? []) {
    if (typeof via === 'string') {
      roots.push(...collectRootAdvisories(report, via, nextStack));
    } else if (via && typeof via === 'object') {
      roots.push(via);
    }
  }
  if (roots.length === 0) roots.push({ unresolved: vulnerabilityName, severity: item.severity });
  const unique = new Map();
  for (const rootAdvisory of roots) {
    const key =
      advisoryId(rootAdvisory) ??
      `unresolved:${rootAdvisory.unresolved ?? rootAdvisory.name ?? vulnerabilityName}`;
    unique.set(key, rootAdvisory);
  }
  return [...unique.values()];
}

function activeWaiverFor(advisory, report, lockPackages, waivers, now) {
  if (advisory.severity !== 'high') return null;
  const id = advisoryId(advisory);
  if (!id) return null;
  const waiver = waivers.find(
    (entry) => entry.id.toUpperCase() === id && entry.package === advisory.name,
  );
  if (!waiver || now > new Date(`${waiver.expiresOn}T23:59:59.999Z`)) return null;
  const vulnerability = report.vulnerabilities[advisory.name];
  if (!vulnerability?.nodes?.length) return null;
  const versions = vulnerability.nodes.map((node) => {
    const normalizedNode = node.replaceAll('\\', '/');
    return lockPackages[normalizedNode]?.version;
  });
  if (versions.some((version) => !version || !waiver.versions.includes(version))) return null;
  return {
    id,
    package: waiver.package,
    versions: [...new Set(versions)].sort(),
    expiresOn: waiver.expiresOn,
    reason: waiver.reason,
    owner: waiver.owner,
    source: waiver.source,
  };
}

export function summarize(
  scope,
  result,
  { lockPackages = {}, waivers = [], now = new Date() } = {},
) {
  validateAuditResult(result);
  const counts = result.report.metadata.vulnerabilities;
  const actionable = [];
  const waived = [];

  for (const item of Object.values(result.report.vulnerabilities)) {
    if (!['high', 'critical'].includes(item.severity)) continue;
    const roots = collectRootAdvisories(result.report, item.name);
    const blockingRoots = roots.filter((rootAdvisory) =>
      ['high', 'critical'].includes(rootAdvisory.severity),
    );
    const appliedWaivers =
      item.severity === 'high'
        ? blockingRoots
            .map((rootAdvisory) =>
              activeWaiverFor(rootAdvisory, result.report, lockPackages, waivers, now),
            )
            .filter(Boolean)
        : [];
    const isWaived =
      blockingRoots.length > 0 &&
      appliedWaivers.length === blockingRoots.length &&
      item.severity !== 'critical';
    const entry = {
      name: item.name,
      severity: item.severity,
      direct: item.isDirect,
      advisories: blockingRoots.map(
        (rootAdvisory) =>
          advisoryId(rootAdvisory) ?? `unresolved:${rootAdvisory.unresolved ?? item.name}`,
      ),
    };
    if (isWaived) {
      waived.push({
        ...entry,
        waivers: [...new Map(appliedWaivers.map((waiver) => [waiver.id, waiver])).values()],
      });
    } else {
      actionable.push(entry);
    }
  }

  return {
    scope,
    status: actionable.length === 0 ? 'passed' : 'failed',
    counts: {
      ...Object.fromEntries(severityOrder.map((severity) => [severity, counts[severity]])),
      total: counts.total,
    },
    effectiveCounts: {
      high: actionable.filter((item) => item.severity === 'high').length,
      critical: actionable.filter((item) => item.severity === 'critical').length,
    },
    actionable,
    waived,
  };
}

async function main() {
  const [lockfile, waiverDocument, productionResult, completeResult] = await Promise.all([
    readFile(lockfilePath, 'utf8').then(JSON.parse),
    readFile(waiverPath, 'utf8').then(JSON.parse),
    runAudit(['--omit=dev']),
    runAudit([]),
  ]);
  const waivers = validateWaiverDocument(waiverDocument);
  const options = { lockPackages: lockfile.packages ?? {}, waivers };
  const scopes = [
    summarize('production', productionResult, options),
    summarize('complete', completeResult, options),
  ];
  const status = scopes.every((scope) => scope.status === 'passed') ? 'passed' : 'failed';
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'dependency-audit.json'),
    `${JSON.stringify(
      {
        formatVersion: 2,
        suite: 'dependency-audit',
        status,
        pii: false,
        generatedAt: new Date().toISOString(),
        policy:
          'No unmitigated high or critical vulnerability in production or development dependency trees.',
        scopes,
      },
      null,
      2,
    )}\n`,
  );
  for (const scope of scopes) {
    process.stdout.write(
      `${scope.scope}: ${JSON.stringify(scope.counts)} effective=${JSON.stringify(scope.effectiveCounts)} waived=${scope.waived.length}\n`,
    );
  }
  if (status !== 'passed') process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
