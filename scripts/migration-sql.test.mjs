import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationFiles = [
  'apps/api/prisma/migrations/20260714234454_add_multi_competition_model/migration.sql',
  'apps/api/prisma/migrations/20260715003000_add_session_version/migration.sql',
  'apps/api/prisma/migrations/20260715010000_complete_multi_competition_constraints/migration.sql',
];

test('expand/migrate SQL contains no destructive contract operation', async () => {
  for (const file of migrationFiles) {
    const sql = await readFile(file, 'utf8');
    assert.doesNotMatch(sql, /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i, file);
  }
});

test('multi-competition completion declares composite uniqueness and cross-scope guards', async () => {
  const sql = await readFile(migrationFiles[2], 'utf8');
  assert.match(sql, /Prediction_poolSeasonId_userId_matchId_key/);
  assert.match(sql, /MatchDay_seasonId_date_key/);
  assert.match(sql, /Round_stageId_seasonId_fkey/);
  assert.match(sql, /Match_roundId_stageId_seasonId_fkey/);
  assert.match(sql, /Prediction_validate_pool_season_scope/);
  assert.match(sql, /RankingSnapshot_validate_scope/);
});
