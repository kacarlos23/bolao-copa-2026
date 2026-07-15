-- Additive transactional outbox for versioned, context-scoped realtime events.
CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "poolSeasonId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboxEvent_publishedAt_occurredAt_idx"
  ON "OutboxEvent"("publishedAt", "occurredAt");
CREATE INDEX "OutboxEvent_seasonId_occurredAt_idx"
  ON "OutboxEvent"("seasonId", "occurredAt");
CREATE INDEX "OutboxEvent_poolSeasonId_occurredAt_idx"
  ON "OutboxEvent"("poolSeasonId", "occurredAt");
CREATE INDEX "OutboxEvent_type_occurredAt_idx"
  ON "OutboxEvent"("type", "occurredAt");
