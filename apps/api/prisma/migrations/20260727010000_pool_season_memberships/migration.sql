-- Participation is scoped to a competition season. Existing active pool participants are
-- preserved in every already-created season; newly registered accounts receive no row.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_NICKNAME_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'POOL_SEASON_MEMBERSHIP_UPDATED';

CREATE TABLE "PoolSeasonMembership" (
    "id" TEXT NOT NULL,
    "poolSeasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PoolMembershipRole" NOT NULL DEFAULT 'MEMBER',
    "status" "PoolMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PoolSeasonMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PoolSeasonMembership_poolSeasonId_userId_key" ON "PoolSeasonMembership"("poolSeasonId", "userId");
CREATE INDEX "PoolSeasonMembership_poolSeasonId_status_idx" ON "PoolSeasonMembership"("poolSeasonId", "status");
CREATE INDEX "PoolSeasonMembership_userId_status_idx" ON "PoolSeasonMembership"("userId", "status");

ALTER TABLE "PoolSeasonMembership" ADD CONSTRAINT "PoolSeasonMembership_poolSeasonId_fkey"
  FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoolSeasonMembership" ADD CONSTRAINT "PoolSeasonMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PoolSeasonMembership" ("id", "poolSeasonId", "userId", "role", "status", "joinedAt", "updatedAt")
SELECT
  'psm-' || md5(ps."id" || ':' || pm."userId"), ps."id", pm."userId", pm."role", pm."status", pm."joinedAt", CURRENT_TIMESTAMP
FROM "PoolMembership" pm
JOIN "PoolSeason" ps ON ps."poolId" = pm."poolId"
ON CONFLICT ("poolSeasonId", "userId") DO NOTHING;
