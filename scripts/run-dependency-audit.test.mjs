import assert from 'node:assert/strict';
import test from 'node:test';

import {
  summarize,
  validateAuditResult,
  validateWaiverDocument,
} from './run-dependency-audit.mjs';

const advisoryUrl = 'https://github.com/advisories/GHSA-mh99-v99m-4gvg';
const nodeV1 = 'node_modules/glob/node_modules/brace-expansion';
const nodeV2 = 'node_modules/minimatch/node_modules/brace-expansion';
const waiverDocument = {
  version: 1,
  entries: [
    {
      id: 'GHSA-mh99-v99m-4gvg',
      package: 'brace-expansion',
      versions: ['1.1.17', '2.1.3', '5.0.8'],
      reason: 'Official upstream backports.',
      owner: 'platform-maintainers',
      source: 'https://github.com/juliangruber/brace-expansion/commit/cb4b9e4',
      expiresOn: '2026-08-12',
    },
  ],
};

function auditResult({
  braceSeverity = 'high',
  rootSeverity = 'high',
  rootUrl = advisoryUrl,
} = {}) {
  return {
    code: 1,
    report: {
      auditReportVersion: 2,
      vulnerabilities: {
        'brace-expansion': {
          name: 'brace-expansion',
          severity: braceSeverity,
          isDirect: false,
          via: [
            {
              source: 1124334,
              name: 'brace-expansion',
              dependency: 'brace-expansion',
              severity: rootSeverity,
              url: rootUrl,
            },
          ],
          nodes: [nodeV1, nodeV2],
        },
        minimatch: {
          name: 'minimatch',
          severity: braceSeverity,
          isDirect: false,
          via: ['brace-expansion'],
          nodes: ['node_modules/minimatch'],
        },
        expo: {
          name: 'expo',
          severity: braceSeverity,
          isDirect: true,
          via: ['minimatch'],
          nodes: ['node_modules/expo'],
        },
      },
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 0,
          high: braceSeverity === 'high' ? 3 : 0,
          critical: braceSeverity === 'critical' ? 3 : 0,
          total: 3,
        },
      },
    },
    stderr: '',
  };
}

const correctedLock = {
  [nodeV1]: { version: '1.1.17' },
  [nodeV2]: { version: '2.1.3' },
};

test('accepts only the official brace-expansion backports and their propagated metavulnerabilities', () => {
  const waivers = validateWaiverDocument(waiverDocument);
  const result = summarize('complete', auditResult(), {
    lockPackages: correctedLock,
    waivers,
    now: new Date('2026-07-29T12:00:00Z'),
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.actionable.length, 0);
  assert.deepEqual(
    result.waived.map((item) => item.name).sort(),
    ['brace-expansion', 'expo', 'minimatch'],
  );
  assert.deepEqual(result.effectiveCounts, { high: 0, critical: 0 });
});

test('rejects an older brace-expansion release even when the advisory id matches', () => {
  const result = summarize('complete', auditResult(), {
    lockPackages: { ...correctedLock, [nodeV1]: { version: '1.1.16' } },
    waivers: validateWaiverDocument(waiverDocument),
    now: new Date('2026-07-29T12:00:00Z'),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionable.length, 3);
});

test('rejects a different high advisory', () => {
  const result = summarize(
    'complete',
    auditResult({ rootUrl: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' }),
    {
      lockPackages: correctedLock,
      waivers: validateWaiverDocument(waiverDocument),
      now: new Date('2026-07-29T12:00:00Z'),
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.actionable.length, 3);
});

test('never waives a critical advisory', () => {
  const result = summarize(
    'complete',
    auditResult({ braceSeverity: 'critical', rootSeverity: 'critical' }),
    {
      lockPackages: correctedLock,
      waivers: validateWaiverDocument(waiverDocument),
      now: new Date('2026-07-29T12:00:00Z'),
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.actionable.length, 3);
  assert.equal(result.effectiveCounts.critical, 3);
});

test('rejects an expired waiver while allowing it to remain documented', () => {
  const result = summarize('complete', auditResult(), {
    lockPackages: correctedLock,
    waivers: validateWaiverDocument(waiverDocument),
    now: new Date('2026-08-13T00:00:00Z'),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.actionable.length, 3);
});

test('fails closed for npm audit operational and schema errors', () => {
  assert.throws(
    () => validateAuditResult({ code: 2, report: {}, stderr: 'network error' }),
    /failed operationally/,
  );
  assert.throws(
    () =>
      validateAuditResult({
        code: 1,
        report: { error: { summary: 'registry unavailable' } },
      }),
    /registry unavailable/,
  );
  assert.throws(
    () =>
      validateAuditResult({
        code: 0,
        report: { auditReportVersion: 2, vulnerabilities: {}, metadata: {} },
      }),
    /invalid vulnerability counters/,
  );
});
