import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration =
  'apps/api/prisma/migrations/20260719010000_brasileirao_temporal_scoreability/migration.sql';

test('Brasileirão temporal scoreability migration is scoped and repeat-safe', async () => {
  const sql = await readFile(migration, 'utf8');

  assert.match(sql, /UPDATE\s+"PoolSeason"/i);
  assert.match(sql, /2026-07-16 03:00:00\.000/);
  assert.match(sql, /"scoreableFromRound"\s*=\s*NULL/);
  assert.match(sql, /"startsAtRound"\s*=\s*NULL/);
  assert.match(sql, /UPDATE\s+"ScoringRuleSet"/i);
  assert.match(sql, /season\."slug"\s*=\s*'brasileirao-serie-a-2026'/);
  assert.match(sql, /competition\."slug"\s*=\s*'brasileirao-serie-a'/);
  assert.match(sql, /pool\."slug"\s*=\s*'bolao-do-trabalho'/);
  assert.match(sql, /brasileirao-2026-v2-temporal/);
  assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE|DROP)\b/i);
});
