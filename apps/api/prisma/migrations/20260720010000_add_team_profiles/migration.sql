CREATE TABLE "TeamProfileSnapshot" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalTeamId" TEXT NOT NULL,
    "state" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "checksum" TEXT NOT NULL,
    "statistics" JSONB NOT NULL,
    "athletes" JSONB NOT NULL,
    "matches" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamProfileSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamProfileSnapshot_seasonId_teamId_provider_key"
ON "TeamProfileSnapshot"("seasonId", "teamId", "provider");

CREATE UNIQUE INDEX "TeamProfileSnapshot_seasonId_provider_externalTeamId_key"
ON "TeamProfileSnapshot"("seasonId", "provider", "externalTeamId");

CREATE INDEX "TeamProfileSnapshot_teamId_collectedAt_idx"
ON "TeamProfileSnapshot"("teamId", "collectedAt");

CREATE INDEX "TeamProfileSnapshot_seasonId_collectedAt_idx"
ON "TeamProfileSnapshot"("seasonId", "collectedAt");

ALTER TABLE "TeamProfileSnapshot"
ADD CONSTRAINT "TeamProfileSnapshot_seasonId_fkey"
FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamProfileSnapshot"
ADD CONSTRAINT "TeamProfileSnapshot_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
