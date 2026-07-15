-- Auditable provider synchronization: runs, distributed locks, quarantine and manual overrides.
CREATE TYPE "ProviderSyncType" AS ENUM ('TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS');
CREATE TYPE "ProviderSyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'DRY_RUN');
CREATE TYPE "SyncQuarantineReason" AS ENUM (
  'INVALID_PAYLOAD',
  'DUPLICATE_EXTERNAL_ID',
  'AMBIGUOUS_NAME',
  'MISSING_MAPPING',
  'INVALID_REFERENCE',
  'CONFLICT'
);

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MATCH_OVERRIDE_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MATCH_OVERRIDE_REMOVED';

CREATE TABLE "ProviderSyncRun" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "type" "ProviderSyncType" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "status" "ProviderSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
  "source" TEXT NOT NULL,
  "checksum" TEXT,
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
  "requestedById" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderSyncLock" (
  "key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "type" "ProviderSyncType" NOT NULL,
  "ownerId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderSyncLock_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "SyncQuarantine" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "type" "ProviderSyncType" NOT NULL,
  "externalId" TEXT,
  "reason" "SyncQuarantineReason" NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "checksum" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncQuarantine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchOverride" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "actorId" TEXT,
  "justification" TEXT NOT NULL,
  "values" JSONB NOT NULL,
  "before" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "MatchOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderSyncRun_provider_seasonId_type_idempotencyKey_key"
  ON "ProviderSyncRun"("provider", "seasonId", "type", "idempotencyKey");
CREATE INDEX "ProviderSyncRun_seasonId_type_startedAt_idx"
  ON "ProviderSyncRun"("seasonId", "type", "startedAt");
CREATE INDEX "ProviderSyncRun_provider_status_startedAt_idx"
  ON "ProviderSyncRun"("provider", "status", "startedAt");
CREATE UNIQUE INDEX "ProviderSyncLock_provider_seasonId_type_key"
  ON "ProviderSyncLock"("provider", "seasonId", "type");
CREATE INDEX "ProviderSyncLock_expiresAt_idx" ON "ProviderSyncLock"("expiresAt");
CREATE INDEX "SyncQuarantine_seasonId_reason_resolvedAt_idx"
  ON "SyncQuarantine"("seasonId", "reason", "resolvedAt");
CREATE INDEX "SyncQuarantine_runId_createdAt_idx" ON "SyncQuarantine"("runId", "createdAt");
CREATE INDEX "SyncQuarantine_provider_externalId_idx"
  ON "SyncQuarantine"("provider", "externalId");
CREATE UNIQUE INDEX "MatchOverride_matchId_key" ON "MatchOverride"("matchId");
CREATE INDEX "MatchOverride_active_updatedAt_idx" ON "MatchOverride"("active", "updatedAt");
CREATE INDEX "MatchOverride_actorId_updatedAt_idx" ON "MatchOverride"("actorId", "updatedAt");

ALTER TABLE "ProviderSyncRun" ADD CONSTRAINT "ProviderSyncRun_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProviderSyncLock" ADD CONSTRAINT "ProviderSyncLock_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncQuarantine" ADD CONSTRAINT "SyncQuarantine_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ProviderSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyncQuarantine" ADD CONSTRAINT "SyncQuarantine_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchOverride" ADD CONSTRAINT "MatchOverride_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchOverride" ADD CONSTRAINT "MatchOverride_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
