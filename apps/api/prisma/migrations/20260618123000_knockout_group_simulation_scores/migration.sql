-- Store group-stage simulator scores separately from regular match predictions.
CREATE TABLE "KnockoutGroupSimulationScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "predictedHomeScore" INTEGER NOT NULL,
    "predictedAwayScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnockoutGroupSimulationScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnockoutGroupSimulationScore_userId_generationId_matchId_key"
    ON "KnockoutGroupSimulationScore"("userId", "generationId", "matchId");

CREATE INDEX "KnockoutGroupSimulationScore_generationId_idx"
    ON "KnockoutGroupSimulationScore"("generationId");

CREATE INDEX "KnockoutGroupSimulationScore_matchId_idx"
    ON "KnockoutGroupSimulationScore"("matchId");

CREATE INDEX "KnockoutGroupSimulationScore_userId_idx"
    ON "KnockoutGroupSimulationScore"("userId");

ALTER TABLE "KnockoutGroupSimulationScore"
    ADD CONSTRAINT "KnockoutGroupSimulationScore_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnockoutGroupSimulationScore"
    ADD CONSTRAINT "KnockoutGroupSimulationScore_generationId_fkey"
    FOREIGN KEY ("generationId") REFERENCES "KnockoutGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnockoutGroupSimulationScore"
    ADD CONSTRAINT "KnockoutGroupSimulationScore_matchId_fkey"
    FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
