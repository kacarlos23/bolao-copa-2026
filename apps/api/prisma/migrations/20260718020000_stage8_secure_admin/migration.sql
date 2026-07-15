-- Etapa 8: administration, immutable audit context, previews and operational jobs.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SEASON_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ROUND_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SYNC_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'MAPPING_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'RULE_SET_ASSIGNED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_SESSION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'JOB_QUEUED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'JOB_PAUSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'JOB_RETRIED';

CREATE TYPE "AdminOperationStatus" AS ENUM ('PREVIEW', 'RUNNING', 'COMPLETED', 'FAILED', 'CONSUMED');
CREATE TYPE "AdminJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE "AdminAuditLog"
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "seasonId" TEXT,
  ADD COLUMN "poolSeasonId" TEXT,
  ADD COLUMN "justification" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "before" JSONB,
  ADD COLUMN "after" JSONB;

CREATE UNIQUE INDEX "AdminAuditLog_idempotencyKey_key" ON "AdminAuditLog"("idempotencyKey");
CREATE INDEX "AdminAuditLog_seasonId_poolSeasonId_createdAt_idx" ON "AdminAuditLog"("seasonId", "poolSeasonId", "createdAt");
CREATE INDEX "AdminAuditLog_requestId_idx" ON "AdminAuditLog"("requestId");

CREATE TABLE "AdminOperation" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "seasonId" TEXT,
  "poolSeasonId" TEXT,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" "AdminOperationStatus" NOT NULL,
  "justification" TEXT NOT NULL,
  "preview" JSONB,
  "affectedCount" INTEGER NOT NULL DEFAULT 0,
  "confirmationHash" TEXT,
  "expiresAt" TIMESTAMP(3),
  "result" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AdminOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminOperation_idempotencyKey_key" ON "AdminOperation"("idempotencyKey");
CREATE INDEX "AdminOperation_actorId_createdAt_idx" ON "AdminOperation"("actorId", "createdAt");
CREATE INDEX "AdminOperation_seasonId_poolSeasonId_createdAt_idx" ON "AdminOperation"("seasonId", "poolSeasonId", "createdAt");
CREATE INDEX "AdminOperation_status_expiresAt_idx" ON "AdminOperation"("status", "expiresAt");

CREATE TABLE "AdminJob" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" "AdminJobStatus" NOT NULL DEFAULT 'QUEUED',
  "seasonId" TEXT NOT NULL,
  "poolSeasonId" TEXT,
  "ruleSetVersionId" TEXT,
  "requestedById" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "affectedCount" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminJob_idempotencyKey_key" ON "AdminJob"("idempotencyKey");
CREATE INDEX "AdminJob_status_createdAt_idx" ON "AdminJob"("status", "createdAt");
CREATE INDEX "AdminJob_seasonId_poolSeasonId_createdAt_idx" ON "AdminJob"("seasonId", "poolSeasonId", "createdAt");
CREATE INDEX "AdminJob_type_status_createdAt_idx" ON "AdminJob"("type", "status", "createdAt");
