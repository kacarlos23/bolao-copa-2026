import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the World Cup backfill never claims ranking snapshots from another scoped season', async () => {
  const source = await readFile('apps/api/prisma/backfill-world-cup-2026.ts', 'utf8');
  const selection = source.match(
    /const rankingSnapshots = await tx\.rankingSnapshot\.findMany\(\{([\s\S]*?)select: \{ id: true, userId: true \}/,
  )?.[1];

  assert.ok(selection, 'ranking snapshot selection must remain explicit');
  assert.match(selection, /\{ seasonId: season\.id \}/);
  assert.match(selection, /\{ poolSeasonId: poolSeason\.id \}/);
  assert.match(selection, /\{ seasonId: null, poolSeasonId: null \}/);
  assert.doesNotMatch(selection, /findMany\(\{\s*select:/);
});
