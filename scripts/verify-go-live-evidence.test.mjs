import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signEvidence, verifyEvidenceSet } from './verify-go-live-evidence.mjs';

const commitSha = 'a'.repeat(40);
const hmacKey = 'stage9-test-key-with-at-least-32-characters';
const now = new Date('2026-07-15T15:00:00.000Z');
const artifact = {
  name: 'sanitized-report',
  url: 'https://evidence.example.test/report.json',
  sha256: 'b'.repeat(64),
};

function common(type, extra) {
  const evidence = {
    formatVersion: 2,
    evidenceType: type,
    status: 'passed',
    pii: false,
    environment: 'production',
    commitSha,
    generatedAt: '2026-07-15T14:00:00.000Z',
    validUntil: '2026-07-16T14:00:00.000Z',
    artifacts: [artifact],
    ...extra,
  };
  evidence.signature = signEvidence(evidence, hmacKey);
  return evidence;
}

function evidenceSet() {
  const smoke = common('smoke', {
    authenticated: true,
    baseUrl: 'https://bolao.example.test',
    viewports: [
      { name: 'mobile', width: 390, height: 844, status: 'passed' },
      { name: 'desktop', width: 1440, height: 900, status: 'passed' },
    ],
    checks: [
      'login',
      'competition-switch',
      'schedule',
      'ranking',
      'prediction-boundary',
      'sse',
      'feature-flags',
    ].map((name) => ({ name, status: 'passed' })),
  });
  const source = common('source-reconciliation', {
    provider: 'cbf-official',
    sourceUrl:
      'https://www.cbf.com.br/futebol-brasileiro/tabelas/campeonato-brasileiro/serie-a/2026',
    counts: {
      teams: 20,
      rounds: 38,
      matches: 380,
      standings: 20,
      openingRound20Matches: 10,
      quarantined: 0,
    },
    documents: [
      { kind: 'TABLE', url: 'https://www.cbf.com.br/table.pdf', sha256: 'c'.repeat(64) },
      { kind: 'REGULATION', url: 'https://www.cbf.com.br/regulation.pdf', sha256: 'd'.repeat(64) },
    ],
    idempotency: { secondImportInserts: 0, secondImportQuarantined: 0 },
  });
  const observability = common('observability', {
    dashboardUrl: 'https://monitoring.example.test/dashboard',
    signals: ['database', 'provider', 'ranking', 'sse', 'outbox', 'backup'].map((name) => ({
      name,
      status: 'passed',
      alertFiredAt: '2026-07-15T14:05:00.000Z',
      recoveredAt: '2026-07-15T14:10:00.000Z',
      dashboardPanelUrl: `https://monitoring.example.test/panel/${name}`,
    })),
  });
  const off = { readEnabled: false, writeEnabled: false, uiEnabled: false };
  const operational = common('operational-rehearsal', {
    backup: {
      kind: 'sanitized-production',
      restoreIsolated: true,
      avatarsRestored: true,
      sha256: 'e'.repeat(64),
    },
    copaHashes: {
      beforeMigration: 'f'.repeat(64),
      afterMigration: 'f'.repeat(64),
      beforeRollback: 'f'.repeat(64),
      afterRollback: 'f'.repeat(64),
    },
    flags: { before: off, after: off, auditLogId: 'audit-1' },
    rollbackPassed: true,
  });
  return {
    smoke,
    'source-reconciliation': source,
    observability,
    'operational-rehearsal': operational,
  };
}

const context = { commitSha, environment: 'production', hmacKey, maxAgeMs: 24 * 60 * 60_000, now };

describe('go-live evidence integrity gate', () => {
  it('accepts complete signed evidence for the exact candidate', () => {
    assert.deepEqual(
      verifyEvidenceSet(evidenceSet(), context).map((check) => check.status),
      ['passed', 'passed', 'passed', 'passed'],
    );
  });

  it('rejects a different candidate even when the stale signature matches its payload', () => {
    const set = evidenceSet();
    set.smoke.commitSha = '1'.repeat(40);
    set.smoke.signature = signEvidence(set.smoke, hmacKey);
    assert.match(verifyEvidenceSet(set, context)[0].errors.join(' '), /commitSha mismatch/);
  });

  it('rejects expired evidence', () => {
    const set = evidenceSet();
    set.smoke.validUntil = '2026-07-15T14:30:00.000Z';
    set.smoke.signature = signEvidence(set.smoke, hmacKey);
    assert.match(verifyEvidenceSet(set, context)[0].errors.join(' '), /expired/);
  });

  it('rejects tampering after signature', () => {
    const set = evidenceSet();
    set['source-reconciliation'].counts.quarantined = 1;
    const errors = verifyEvidenceSet(set, context)[1].errors.join(' ');
    assert.match(errors, /quarantined/);
    assert.match(errors, /signature mismatch/);
  });

  it('rejects observability without a proved alert recovery', () => {
    const set = evidenceSet();
    set.observability.signals[0].recoveredAt = set.observability.signals[0].alertFiredAt;
    set.observability.signature = signEvidence(set.observability, hmacKey);
    assert.match(verifyEvidenceSet(set, context)[2].errors.join(' '), /database/);
  });
});
