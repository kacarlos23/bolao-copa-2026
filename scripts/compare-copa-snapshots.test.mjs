import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareBackfillSnapshots,
  compareSnapshots,
  validateSnapshot,
} from './compare-copa-snapshots.mjs';

function snapshot() {
  return {
    formatVersion: 1,
    scope: 'world-cup-2026',
    counts: {
      activeUsers: 2,
      matches: 72,
      predictions: 144,
      scores: 144,
      knockoutFixtures: 32,
    },
    scoreCounts: { group: 120, knockout: 24 },
    predictionCounts: { matches: 120, knockoutPicks: 24, knockoutGroupSimulations: 0 },
    contentHashes: { Match: 'physical-hash' },
    businessContentHashes: { Match: 'business-hash' },
    ranking: [{ rank: 1, userId: 'u1', nickname: 'Ana', points: 15 }],
    userTotals: [{ userId: 'u1', nickname: 'Ana', points: 15 }],
  };
}

test('accepts the preservation snapshot contract', () => {
  assert.doesNotThrow(() => validateSnapshot(snapshot()));
});

test('reports no differences for equivalent snapshots regardless of object key order', () => {
  const before = snapshot();
  const after = JSON.parse(JSON.stringify(before));
  after.counts = Object.fromEntries(Object.entries(after.counts).reverse());

  assert.deepEqual(compareSnapshots(before, after), []);
});

test('reports count and ordered ranking differences with precise paths', () => {
  const before = snapshot();
  const after = JSON.parse(JSON.stringify(before));
  after.counts.predictions += 1;
  after.ranking[0].points += 3;

  assert.deepEqual(
    compareSnapshots(before, after).map((difference) => difference.path),
    ['counts.predictions', 'ranking[0].points'],
  );
});

test('rejects a snapshot missing a mandatory count', () => {
  const invalid = snapshot();
  delete invalid.counts.knockoutFixtures;

  assert.throws(() => validateSnapshot(invalid), /knockoutFixtures/);
});

test('backfill comparison ignores structural hashes and preserves business hashes', () => {
  const before = snapshot();
  const after = JSON.parse(JSON.stringify(before));
  after.contentHashes.Match = 'changed-by-context-columns';
  after.contentHashes.Competition = 'new-table';

  assert.deepEqual(compareBackfillSnapshots(before, after), []);
});

test('backfill comparison detects a protected business change', () => {
  const before = snapshot();
  const after = JSON.parse(JSON.stringify(before));
  after.businessContentHashes.Match = 'changed-result';

  assert.deepEqual(
    compareBackfillSnapshots(before, after).map((difference) => difference.path),
    ['businessContentHashes.Match'],
  );
});
