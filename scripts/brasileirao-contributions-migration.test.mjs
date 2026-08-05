import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration =
  'apps/api/prisma/migrations/20260805010000_brasileirao_contributions/migration.sql';

test('Brasileirão contribution backfill creates one round-20 account for every active participant', async () => {
  const sql = await readFile(migration, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS "PoolSeasonContributionConfig"/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "PoolSeasonContributionAccount"/);
  assert.match(sql, /"amountPerRoundCents"[ \t]+INTEGER NOT NULL DEFAULT 1000/);
  assert.match(sql, /"defaultStartRound"[ \t]+INTEGER NOT NULL DEFAULT 20/);
  assert.match(sql, /CHECK \("defaultStartRound" = 20\)/);
  assert.match(sql, /CHECK \("startRound" >= 20\)/);
  assert.match(sql, /JOIN "PoolSeasonMembership" AS membership[\s\S]*membership\."status" = 'ACTIVE'/);
  assert.match(sql, /membership\."userId",[\s\S]*config\."defaultStartRound"/);
  assert.match(sql, /ON CONFLICT \("poolSeasonId", "userId"\) DO NOTHING/);
  assert.match(sql, /pool\."slug" = 'bolao-do-trabalho'/);
  assert.match(sql, /season\."slug" = 'brasileirao-serie-a-2026'/);
  assert.match(sql, /competition\."slug" = 'brasileirao-serie-a'/);
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE)\s+"PoolSeasonFundraising"/i);
  assert.doesNotMatch(sql, /^\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|COLUMN|TYPE))\b/im);
});
