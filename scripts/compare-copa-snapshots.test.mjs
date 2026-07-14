import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSnapshots, validateSnapshot } from './compare-copa-snapshots.mjs';

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
