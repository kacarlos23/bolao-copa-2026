-- Brasileirão Série A 2026: immutable 6/3+1/1/0 rule, round-20 reset and
-- PoolSeason-scoped fundraising. Historical predictions and match results stay intact.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'FUNDRAISING_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RANKING_REPROCESSED';

UPDATE "Competition"
SET
  "capabilities" = COALESCE("capabilities", '{}'::jsonb) || '{"fundraising":true}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'brasileirao-serie-a';

CREATE TABLE IF NOT EXISTS "PoolSeasonFundraising" (
  "poolSeasonId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "lastJustification" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PoolSeasonFundraising_pkey" PRIMARY KEY ("poolSeasonId"),
  CONSTRAINT "PoolSeasonFundraising_amountCents_check"
    CHECK ("amountCents" >= 0 AND "amountCents" <= 100000000)
);

CREATE INDEX IF NOT EXISTS "PoolSeasonFundraising_updatedById_updatedAt_idx"
  ON "PoolSeasonFundraising"("updatedById", "updatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PoolSeasonFundraising_poolSeasonId_fkey'
  ) THEN
    ALTER TABLE "PoolSeasonFundraising"
      ADD CONSTRAINT "PoolSeasonFundraising_poolSeasonId_fkey"
      FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PoolSeasonFundraising_updatedById_fkey'
  ) THEN
    ALTER TABLE "PoolSeasonFundraising"
      ADD CONSTRAINT "PoolSeasonFundraising_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "ScoringRuleSet" (
  "id", "key", "name", "version", "rules", "tieBreakers", "effectiveAt", "metadata"
)
VALUES (
  'scoring-rule-set-brasileirao-6-3-plus-1-0-v2',
  'brasileirao-serie-a',
  'Brasileirão 6/3+1/1/0',
  2,
  '{"exactScore":6,"correctOutcome":3,"oneTeamGoals":1,"miss":0,"addTeamGoalsBonusToCorrectOutcome":true}'::jsonb,
  '["points","exactScores","resultHits","oneGoalHits","fewerMisses","name"]'::jsonb,
  CURRENT_TIMESTAMP,
  '{"source":"packages/shared/src/scoring.ts","immutableVersionKey":"brasileirao-6-3-plus-1-0"}'::jsonb
)
ON CONFLICT ("key", "version") DO NOTHING;

INSERT INTO "ScoringRuleSetVersion" (
  "id", "key", "name", "version", "rules", "checksum", "effectiveAt", "seasonId"
)
SELECT
  'scoring-rule-set-version-brasileirao-6-3-plus-1-0-v1',
  'brasileirao-6-3-plus-1-0',
  'Brasileirão 6/3+1/1/0',
  1,
  '{"exactScore":6,"correctOutcome":3,"oneTeamGoals":1,"miss":0,"addTeamGoalsBonusToCorrectOutcome":true}'::jsonb,
  'brasileirao-6-3-plus-1-0:v1:6-3-plus-1-0',
  CURRENT_TIMESTAMP,
  season."id"
FROM "CompetitionSeason" AS season
JOIN "Competition" AS competition ON competition."id" = season."competitionId"
WHERE season."slug" = 'brasileirao-serie-a-2026'
  AND competition."slug" = 'brasileirao-serie-a'
ON CONFLICT ("key", "version") DO NOTHING;

UPDATE "PoolSeason" AS pool_season
SET
  "scoringRuleSetId" = scoring."id",
  "scoringRuleSetVersionId" = rule_version."id",
  "scoreableFromRound" = 20,
  "scoreableFrom" = NULL,
  "startsAtRound" = 20,
  "historicalMatchesScoreable" = false,
  "metadata" = COALESCE(pool_season."metadata", '{}'::jsonb)
    || '{"policyVersion":"brasileirao-2026-v3-round-20","rankingResetFromRound":20}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CompetitionSeason" AS season
JOIN "Competition" AS competition ON competition."id" = season."competitionId"
JOIN "Pool" AS pool ON pool."slug" = 'bolao-do-trabalho'
JOIN "ScoringRuleSet" AS scoring
  ON scoring."key" = 'brasileirao-serie-a' AND scoring."version" = 2
JOIN "ScoringRuleSetVersion" AS rule_version
  ON rule_version."key" = 'brasileirao-6-3-plus-1-0' AND rule_version."version" = 1
WHERE pool_season."seasonId" = season."id"
  AND pool_season."poolId" = pool."id"
  AND season."slug" = 'brasileirao-serie-a-2026'
  AND competition."slug" = 'brasileirao-serie-a';

INSERT INTO "PoolSeasonFundraising" (
  "poolSeasonId", "amountCents", "lastJustification", "updatedAt"
)
SELECT
  pool_season."id",
  0,
  'Inicialização auditável da ação entre amigos',
  CURRENT_TIMESTAMP
FROM "PoolSeason" AS pool_season
JOIN "CompetitionSeason" AS season ON season."id" = pool_season."seasonId"
JOIN "Competition" AS competition ON competition."id" = season."competitionId"
JOIN "Pool" AS pool ON pool."id" = pool_season."poolId"
WHERE pool."slug" = 'bolao-do-trabalho'
  AND season."slug" = 'brasileirao-serie-a-2026'
  AND competition."slug" = 'brasileirao-serie-a'
ON CONFLICT ("poolSeasonId") DO NOTHING;
