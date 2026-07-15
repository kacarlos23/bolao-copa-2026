import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.join(root, 'output', 'release-gates');
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
const REQUIRED_SMOKE_CHECKS = [
  'login',
  'competition-switch',
  'schedule',
  'ranking',
  'prediction-boundary',
  'sse',
  'feature-flags',
];
const REQUIRED_SIGNALS = ['database', 'provider', 'ranking', 'sse', 'outbox', 'backup'];

const evidenceInputs = [
  ['GO_LIVE_SMOKE_EVIDENCE', 'smoke', 'smoke autenticado'],
  ['GO_LIVE_SOURCE_RECONCILIATION', 'source-reconciliation', 'fonte oficial reconciliada'],
  ['GO_LIVE_OBSERVABILITY_EVIDENCE', 'observability', 'observabilidade e alertas'],
  ['GO_LIVE_OPERATIONAL_EVIDENCE', 'operational-rehearsal', 'backup, flags e preservação'],
];

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sorted(child)]),
    );
  }
  return value;
}

export function canonicalEvidence(evidence) {
  const { signature: _signature, ...unsigned } = evidence;
  return JSON.stringify(sorted(unsigned));
}

export function signEvidence(evidence, key) {
  return createHmac('sha256', key).update(canonicalEvidence(evidence)).digest('hex');
}

function equalSignature(actual, expected) {
  if (!SHA256.test(actual ?? '') || !SHA256.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function validDate(value) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validUrl(value) {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function validateArtifacts(artifacts, errors) {
  if (!Array.isArray(artifacts) || artifacts.length === 0 || artifacts.length > 20) {
    errors.push('artifacts must contain 1..20 entries');
    return;
  }
  for (const artifact of artifacts) {
    if (
      !object(artifact) ||
      typeof artifact.name !== 'string' ||
      artifact.name.length < 3 ||
      !validUrl(artifact.url) ||
      !SHA256.test(artifact.sha256 ?? '')
    ) {
      errors.push('artifact reference is invalid');
    }
  }
}

function validateCommon(evidence, expectedType, context, errors) {
  if (!object(evidence)) {
    errors.push('evidence is not an object');
    return;
  }
  if (evidence.formatVersion !== 2) errors.push('formatVersion must be 2');
  if (evidence.evidenceType !== expectedType) errors.push('evidenceType mismatch');
  if (evidence.status !== 'passed') errors.push('status must be passed');
  if (evidence.pii !== false) errors.push('pii must be false');
  if (evidence.environment !== context.environment) errors.push('environment mismatch');
  if (!COMMIT_SHA.test(evidence.commitSha ?? '') || evidence.commitSha !== context.commitSha) {
    errors.push('commitSha mismatch');
  }
  const generatedAt = validDate(evidence.generatedAt);
  const validUntil = validDate(evidence.validUntil);
  if (!generatedAt || !validUntil) {
    errors.push('timestamps are invalid');
  } else {
    if (generatedAt.getTime() > context.now.getTime() + 5 * 60_000) {
      errors.push('generatedAt is in the future');
    }
    if (context.now.getTime() - generatedAt.getTime() > context.maxAgeMs) {
      errors.push('evidence is stale');
    }
    if (validUntil.getTime() <= context.now.getTime()) errors.push('evidence is expired');
    if (validUntil.getTime() > generatedAt.getTime() + 48 * 60 * 60_000) {
      errors.push('validity window exceeds 48h');
    }
  }
  validateArtifacts(evidence.artifacts, errors);
  const expectedSignature = signEvidence(evidence, context.hmacKey);
  if (!equalSignature(evidence.signature, expectedSignature)) errors.push('signature mismatch');
}

function validatePassedChecks(checks, requiredNames, errors) {
  if (!Array.isArray(checks)) {
    errors.push('checks must be an array');
    return;
  }
  for (const name of requiredNames) {
    const check = checks.find((item) => object(item) && item.name === name);
    if (!check || check.status !== 'passed') errors.push(`required check failed: ${name}`);
  }
}

function validateSmoke(evidence, errors) {
  if (evidence.authenticated !== true) errors.push('smoke must be authenticated');
  if (!validUrl(evidence.baseUrl)) errors.push('smoke baseUrl must use https');
  validatePassedChecks(evidence.checks, REQUIRED_SMOKE_CHECKS, errors);
  if (!Array.isArray(evidence.viewports)) {
    errors.push('viewports must be an array');
  } else {
    const passed = evidence.viewports.filter((item) => object(item) && item.status === 'passed');
    if (!passed.some((item) => Number.isInteger(item.width) && item.width <= 480)) {
      errors.push('mobile viewport evidence is missing');
    }
    if (!passed.some((item) => Number.isInteger(item.width) && item.width >= 1024)) {
      errors.push('desktop viewport evidence is missing');
    }
  }
}

function validateSource(evidence, errors) {
  if (evidence.provider !== 'cbf-official') errors.push('provider must be cbf-official');
  if (!validUrl(evidence.sourceUrl)) errors.push('sourceUrl must use https');
  const counts = object(evidence.counts);
  const exactCounts = {
    teams: 20,
    rounds: 38,
    matches: 380,
    standings: 20,
    openingRound20Matches: 10,
    quarantined: 0,
  };
  for (const [key, expected] of Object.entries(exactCounts)) {
    if (counts?.[key] !== expected) errors.push(`source count mismatch: ${key}`);
  }
  if (!Array.isArray(evidence.documents) || evidence.documents.length < 2) {
    errors.push('document reconciliation is incomplete');
  } else {
    for (const kind of ['TABLE', 'REGULATION']) {
      const document = evidence.documents.find((item) => object(item) && item.kind === kind);
      if (!document || !validUrl(document.url) || !SHA256.test(document.sha256 ?? '')) {
        errors.push(`document is invalid: ${kind}`);
      }
    }
  }
  if (
    evidence.idempotency?.secondImportInserts !== 0 ||
    evidence.idempotency?.secondImportQuarantined !== 0
  ) {
    errors.push('source import is not idempotent');
  }
}

function validateObservability(evidence, errors) {
  if (!validUrl(evidence.dashboardUrl)) errors.push('dashboardUrl must use https');
  if (!Array.isArray(evidence.signals)) {
    errors.push('signals must be an array');
    return;
  }
  for (const name of REQUIRED_SIGNALS) {
    const signal = evidence.signals.find((item) => object(item) && item.name === name);
    const firedAt = validDate(signal?.alertFiredAt);
    const recoveredAt = validDate(signal?.recoveredAt);
    if (
      !signal ||
      signal.status !== 'passed' ||
      !firedAt ||
      !recoveredAt ||
      recoveredAt <= firedAt ||
      !validUrl(signal.dashboardPanelUrl)
    ) {
      errors.push(`observability signal is incomplete: ${name}`);
    }
  }
}

function allFlagsOff(value) {
  return (
    object(value) &&
    value.readEnabled === false &&
    value.writeEnabled === false &&
    value.uiEnabled === false
  );
}

function validateOperational(evidence, errors) {
  if (
    evidence.backup?.kind !== 'sanitized-production' ||
    evidence.backup?.restoreIsolated !== true ||
    evidence.backup?.avatarsRestored !== true ||
    !SHA256.test(evidence.backup?.sha256 ?? '')
  ) {
    errors.push('production-derived backup/restore evidence is incomplete');
  }
  const hashes = object(evidence.copaHashes);
  const hashValues = hashes
    ? ['beforeMigration', 'afterMigration', 'beforeRollback', 'afterRollback'].map(
        (key) => hashes[key],
      )
    : [];
  if (hashValues.length !== 4 || hashValues.some((value) => !SHA256.test(value ?? ''))) {
    errors.push('Copa hashes are invalid');
  } else if (new Set(hashValues).size !== 1) {
    errors.push('Copa hashes changed');
  }
  if (
    !allFlagsOff(evidence.flags?.before) ||
    !allFlagsOff(evidence.flags?.after) ||
    typeof evidence.flags?.auditLogId !== 'string' ||
    evidence.flags.auditLogId.length < 1
  ) {
    errors.push('feature flag audit evidence is incomplete');
  }
  if (evidence.rollbackPassed !== true) errors.push('rollback was not proven');
}

const validators = {
  smoke: validateSmoke,
  'source-reconciliation': validateSource,
  observability: validateObservability,
  'operational-rehearsal': validateOperational,
};

export function verifyEvidenceSet(evidenceByType, context) {
  return evidenceInputs.map(([, type, label]) => {
    const errors = [];
    const evidence = evidenceByType[type];
    validateCommon(evidence, type, context, errors);
    if (object(evidence)) validators[type](evidence, errors);
    return { label, type, status: errors.length === 0 ? 'passed' : 'invalid', errors };
  });
}

async function main() {
  const commitSha = (
    process.env.GO_LIVE_EXPECTED_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    ''
  ).toLowerCase();
  const environment = process.env.GO_LIVE_EXPECTED_ENVIRONMENT ?? 'production';
  const hmacKey = process.env.GO_LIVE_EVIDENCE_HMAC_KEY ?? '';
  const maxAgeHours = Number(process.env.GO_LIVE_EVIDENCE_MAX_AGE_HOURS ?? 24);
  const preflightErrors = [];
  if (!COMMIT_SHA.test(commitSha))
    preflightErrors.push('expected commit SHA is missing or invalid');
  if (hmacKey.length < 32)
    preflightErrors.push('evidence HMAC key must contain at least 32 characters');
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || maxAgeHours > 48) {
    preflightErrors.push('GO_LIVE_EVIDENCE_MAX_AGE_HOURS must be within 0..48');
  }

  const evidenceByType = {};
  const inputErrors = [];
  for (const [variable, type] of evidenceInputs) {
    const file = process.env[variable];
    if (!file) {
      inputErrors.push(`${variable} is missing`);
      continue;
    }
    try {
      evidenceByType[type] = JSON.parse(await readFile(path.resolve(file), 'utf8'));
    } catch {
      inputErrors.push(`${variable} is unreadable or invalid JSON`);
    }
  }

  const context = {
    commitSha,
    environment,
    hmacKey,
    maxAgeMs: maxAgeHours * 60 * 60_000,
    now: new Date(),
  };
  const checks = verifyEvidenceSet(evidenceByType, context);
  const status =
    preflightErrors.length === 0 &&
    inputErrors.length === 0 &&
    checks.every((check) => check.status === 'passed')
      ? 'passed'
      : 'failed';
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'go-live-external.json'),
    `${JSON.stringify(
      {
        formatVersion: 2,
        suite: 'go-live-external',
        status,
        pii: false,
        commitSha: COMMIT_SHA.test(commitSha) ? commitSha : null,
        environment,
        checkedAt: context.now.toISOString(),
        preflightErrors,
        inputErrors,
        checks,
      },
      null,
      2,
    )}\n`,
  );
  if (status !== 'passed') {
    process.stderr.write(
      'NO-GO: evidências externas não pertencem ao candidato ou estão incompletas.\n',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
