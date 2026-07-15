import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = 'apps/api/prisma/migrations/20260718010000_stage7_scoring_gamification/migration.sql';

test('stage 7 registers immutable 15/3/1/0 v1 without recalculating historical points', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /ScoringRuleSetVersion_immutable/);
  assert.match(sql, /TieBreakerRuleSet_immutable/);
  assert.match(sql, /"exactScore":15,"correctOutcome":3,"oneTeamGoals":1,"miss":0/);
  assert.doesNotMatch(sql, /UPDATE\s+"(?:PredictionScore|KnockoutPredictionScore)"[\s\S]{0,500}SET[\s\S]{0,500}"points"\s*=/i);
});

test('stage 7 declares idempotency and PoolSeason isolation keys', async () => {
  const sql = await readFile(migration, 'utf8');
  for (const key of [
    'ScoreRecomputationAudit_idempotencyKey_key',
    'UserAchievement_poolSeasonId_userId_definitionId_key',
    'Streak_poolSeasonId_userId_type_key',
    'RankingMovement_poolSeasonId_userId_fromSnapshotId_toSnapshotId_key',
    'NotificationInbox_idempotencyKey_key',
    'OutboxEvent_idempotencyKey_key',
  ]) assert.match(sql, new RegExp(key));
});
