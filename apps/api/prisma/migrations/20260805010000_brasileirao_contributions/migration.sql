-- Round-based participant contributions for Brasileirão Série A 2026.
-- This is intentionally independent from PoolSeasonFundraising, which remains
-- the manually managed prize-pot amount.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONTRIBUTION_PAYMENT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONTRIBUTION_PAYMENT_VOIDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONTRIBUTION_ACCOUNT_UPDATED';

DO $$
BEGIN
  CREATE TYPE "ContributionTransactionKind" AS ENUM ('PAYMENT', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PoolSeasonContributionConfig" (
  "poolSeasonId" TEXT NOT NULL,
  "amountPerRoundCents" INTEGER NOT NULL DEFAULT 1000,
  "defaultStartRound" INTEGER NOT NULL DEFAULT 20,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PoolSeasonContributionConfig_pkey" PRIMARY KEY ("poolSeasonId"),
  CONSTRAINT "PoolSeasonContributionConfig_amountPerRoundCents_check"
    CHECK ("amountPerRoundCents" = 1000),
  CONSTRAINT "PoolSeasonContributionConfig_defaultStartRound_check"
    CHECK ("defaultStartRound" = 20)
);

CREATE INDEX IF NOT EXISTS "PoolSeasonContributionConfig_defaultStartRound_idx"
  ON "PoolSeasonContributionConfig"("defaultStartRound");

CREATE TABLE IF NOT EXISTS "PoolSeasonContributionAccount" (
  "id" TEXT NOT NULL,
  "poolSeasonId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startRound" INTEGER NOT NULL,
  "endRound" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PoolSeasonContributionAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PoolSeasonContributionAccount_startRound_check"
    CHECK ("startRound" >= 20),
  CONSTRAINT "PoolSeasonContributionAccount_round_range_check"
    CHECK ("endRound" IS NULL OR "endRound" >= "startRound")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PoolSeasonContributionAccount_poolSeasonId_userId_key"
  ON "PoolSeasonContributionAccount"("poolSeasonId", "userId");
CREATE INDEX IF NOT EXISTS "PoolSeasonContributionAccount_poolSeasonId_startRound_endRound_idx"
  ON "PoolSeasonContributionAccount"("poolSeasonId", "startRound", "endRound");
CREATE INDEX IF NOT EXISTS "PoolSeasonContributionAccount_userId_poolSeasonId_idx"
  ON "PoolSeasonContributionAccount"("userId", "poolSeasonId");

CREATE TABLE IF NOT EXISTS "PoolSeasonContributionTransaction" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "kind" "ContributionTransactionKind" NOT NULL DEFAULT 'PAYMENT',
  "amountCents" INTEGER NOT NULL,
  "justification" TEXT NOT NULL,
  "createdById" TEXT,
  "voidsTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PoolSeasonContributionTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PoolSeasonContributionTransaction_amountCents_check"
    CHECK ("amountCents" > 0 AND "amountCents" <= 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "PoolSeasonContributionTransaction_voidsTransactionId_key"
  ON "PoolSeasonContributionTransaction"("voidsTransactionId");
CREATE INDEX IF NOT EXISTS "PoolSeasonContributionTransaction_accountId_roundId_kind_idx"
  ON "PoolSeasonContributionTransaction"("accountId", "roundId", "kind");
CREATE INDEX IF NOT EXISTS "PoolSeasonContributionTransaction_roundId_createdAt_idx"
  ON "PoolSeasonContributionTransaction"("roundId", "createdAt");
CREATE INDEX IF NOT EXISTS "PoolSeasonContributionTransaction_createdById_createdAt_idx"
  ON "PoolSeasonContributionTransaction"("createdById", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PoolSeasonContributionConfig_poolSeasonId_fkey') THEN
    ALTER TABLE "PoolSeasonContributionConfig"
      ADD CONSTRAINT "PoolSeasonContributionConfig_poolSeasonId_fkey"
      FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PoolSeasonContributionAccount_poolSeasonId_fkey') THEN
    ALTER TABLE "PoolSeasonContributionAccount"
      ADD CONSTRAINT "PoolSeasonContributionAccount_poolSeasonId_fkey"
      FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PoolSeasonContributionAccount_userId_fkey') THEN
    ALTER TABLE "PoolSeasonContributionAccount"
      ADD CONSTRAINT "PoolSeasonContributionAccount_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PoolSeasonContributionTransaction_accountId_fkey') THEN
    ALTER TABLE "PoolSeasonContributionTransaction"
      ADD CONSTRAINT "PoolSeasonContributionTransaction_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "PoolSeasonContributionAccount"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PoolSeasonContributionTransaction_roundId_fkey') THEN
    ALTER TABLE "PoolSeasonContributionTransaction"
      ADD CONSTRAINT "PoolSeasonContributionTransaction_roundId_fkey"
      FOREIGN KEY ("roundId") REFERENCES "Round"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PoolSeasonContributionTransaction_createdById_fkey') THEN
    ALTER TABLE "PoolSeasonContributionTransaction"
      ADD CONSTRAINT "PoolSeasonContributionTransaction_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PoolSeasonContributionTransaction_voidsTransactionId_fkey') THEN
    ALTER TABLE "PoolSeasonContributionTransaction"
      ADD CONSTRAINT "PoolSeasonContributionTransaction_voidsTransactionId_fkey"
      FOREIGN KEY ("voidsTransactionId") REFERENCES "PoolSeasonContributionTransaction"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Only the active members of the target pool season get a new contribution
-- account. Existing manual fundraising is not imported or changed.
INSERT INTO "PoolSeasonContributionConfig" (
  "poolSeasonId", "amountPerRoundCents", "defaultStartRound", "createdAt", "updatedAt"
)
SELECT pool_season."id", 1000, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "PoolSeason" AS pool_season
JOIN "CompetitionSeason" AS season ON season."id" = pool_season."seasonId"
JOIN "Competition" AS competition ON competition."id" = season."competitionId"
JOIN "Pool" AS pool ON pool."id" = pool_season."poolId"
WHERE pool."slug" = 'bolao-do-trabalho'
  AND season."slug" = 'brasileirao-serie-a-2026'
  AND competition."slug" = 'brasileirao-serie-a'
ON CONFLICT ("poolSeasonId") DO NOTHING;

INSERT INTO "PoolSeasonContributionAccount" (
  "id", "poolSeasonId", "userId", "startRound", "createdAt", "updatedAt"
)
SELECT
  'psca-' || md5(pool_season."id" || ':' || membership."userId"),
  pool_season."id",
  membership."userId",
  config."defaultStartRound",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "PoolSeason" AS pool_season
JOIN "CompetitionSeason" AS season ON season."id" = pool_season."seasonId"
JOIN "Competition" AS competition ON competition."id" = season."competitionId"
JOIN "Pool" AS pool ON pool."id" = pool_season."poolId"
JOIN "PoolSeasonContributionConfig" AS config ON config."poolSeasonId" = pool_season."id"
JOIN "PoolSeasonMembership" AS membership
  ON membership."poolSeasonId" = pool_season."id" AND membership."status" = 'ACTIVE'
JOIN "User" AS participant
  ON participant."id" = membership."userId" AND participant."status" = 'ACTIVE'
WHERE pool."slug" = 'bolao-do-trabalho'
  AND season."slug" = 'brasileirao-serie-a-2026'
  AND competition."slug" = 'brasileirao-serie-a'
ON CONFLICT ("poolSeasonId", "userId") DO NOTHING;

UPDATE "Competition"
SET
  "capabilities" = COALESCE("capabilities", '{}'::jsonb)
    || '{"fundraising":true,"contributions":true}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'brasileirao-serie-a';
