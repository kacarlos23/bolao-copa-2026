import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationFiles = [
  'apps/api/prisma/migrations/20260714234454_add_multi_competition_model/migration.sql',
  'apps/api/prisma/migrations/20260715003000_add_session_version/migration.sql',
  'apps/api/prisma/migrations/20260715010000_complete_multi_competition_constraints/migration.sql',
  'apps/api/prisma/migrations/20260721010000_add_generic_ties/migration.sql',
  'apps/api/prisma/migrations/20260722010000_add_configurable_cup_providers/migration.sql',
];

test('expand/migrate SQL contains no destructive contract operation', async () => {
  for (const file of migrationFiles) {
    const sql = await readFile(file, 'utf8');
    assert.doesNotMatch(sql, /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i, file);
  }
});

test('Tie migration is expand-only and preserves every legacy knockout row', async () => {
  const sql = await readFile(migrationFiles[3], 'utf8');
  assert.doesNotMatch(
    sql,
    /^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER\s+TABLE\s+"(?:KnockoutFixture|KnockoutPick|KnockoutPredictionScore)")\b/im,
  );
  assert.match(sql, /ALTER TYPE "ProviderEntityType" ADD VALUE 'TIE'/);
  assert.match(sql, /CREATE TABLE "Tie"/);
  assert.match(sql, /Match_tie_context_fkey/);
  assert.match(sql, /Match_validate_tie_membership/);
  assert.match(sql, /Tie_decision_state_check/);
  assert.match(sql, /Tie_sport_winner_consistency_check/);
  assert.doesNotMatch(sql, /TiePrediction/);
});

test('provider configuration migration is additive, persisted and season-scoped', async () => {
  const sql = await readFile(migrationFiles[4], 'utf8');
  assert.match(sql, /CREATE TABLE "SeasonProviderConfig"/);
  assert.match(sql, /prompt-1-metadata-migration/);
  assert.match(sql, /ProviderEntityMapping_provider_scopeKey_entityType_externalId_key/);
  assert.match(sql, /ALTER TYPE "ProviderSyncType" ADD VALUE 'TIES'/);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE\s+FROM/i);
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
