-- CreateEnum
CREATE TYPE "KnockoutStage" AS ENUM ('ROUND_OF_32', 'ROUND_OF_16', 'QUARTER_FINAL', 'SEMI_FINAL', 'THIRD_PLACE', 'FINAL');

-- CreateEnum
CREATE TYPE "KnockoutGenerationMode" AS ENUM ('PROVISIONAL', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "KnockoutGenerationStatus" AS ENUM ('ACTIVE', 'LOCKED', 'RESET');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "fifaRank" INTEGER;

-- CreateTable
CREATE TABLE "KnockoutFixture" (
    "id" TEXT NOT NULL,
    "matchNumber" INTEGER NOT NULL,
    "stage" "KnockoutStage" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "homeSource" TEXT NOT NULL,
    "awaySource" TEXT NOT NULL,
    "homeTeamId" TEXT,
    "awayTeamId" TEXT,
    "winnerTeamId" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "finalHomeScore" INTEGER,
    "finalAwayScore" INTEGER,
    "rawPayload" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnockoutFixture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnockoutGeneration" (
    "id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "mode" "KnockoutGenerationMode" NOT NULL,
    "status" "KnockoutGenerationStatus" NOT NULL DEFAULT 'ACTIVE',
    "closesAt" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnockoutGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnockoutBracket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnockoutBracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnockoutPick" (
    "id" TEXT NOT NULL,
    "bracketId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "advancingTeamId" TEXT NOT NULL,
    "predictedHomeScore" INTEGER NOT NULL,
    "predictedAwayScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnockoutPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnockoutPredictionScore" (
    "id" TEXT NOT NULL,
    "pickId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "scoreType" "ScoreType" NOT NULL,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnockoutPredictionScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutFixture_matchNumber_key" ON "KnockoutFixture"("matchNumber");

-- CreateIndex
CREATE INDEX "KnockoutFixture_stage_startsAt_idx" ON "KnockoutFixture"("stage", "startsAt");

-- CreateIndex
CREATE INDEX "KnockoutFixture_status_startsAt_idx" ON "KnockoutFixture"("status", "startsAt");

-- CreateIndex
CREATE INDEX "KnockoutFixture_homeTeamId_idx" ON "KnockoutFixture"("homeTeamId");

-- CreateIndex
CREATE INDEX "KnockoutFixture_awayTeamId_idx" ON "KnockoutFixture"("awayTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutGeneration_sequence_key" ON "KnockoutGeneration"("sequence");

-- CreateIndex
CREATE INDEX "KnockoutGeneration_mode_status_idx" ON "KnockoutGeneration"("mode", "status");

-- CreateIndex
CREATE INDEX "KnockoutGeneration_closesAt_idx" ON "KnockoutGeneration"("closesAt");

-- CreateIndex
CREATE INDEX "KnockoutBracket_generationId_submittedAt_idx" ON "KnockoutBracket"("generationId", "submittedAt");

-- CreateIndex
CREATE INDEX "KnockoutBracket_userId_idx" ON "KnockoutBracket"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutBracket_userId_generationId_key" ON "KnockoutBracket"("userId", "generationId");

-- CreateIndex
CREATE INDEX "KnockoutPick_fixtureId_idx" ON "KnockoutPick"("fixtureId");

-- CreateIndex
CREATE INDEX "KnockoutPick_advancingTeamId_idx" ON "KnockoutPick"("advancingTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutPick_bracketId_fixtureId_key" ON "KnockoutPick"("bracketId", "fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "KnockoutPredictionScore_pickId_key" ON "KnockoutPredictionScore"("pickId");

-- CreateIndex
CREATE INDEX "KnockoutPredictionScore_userId_isFinal_idx" ON "KnockoutPredictionScore"("userId", "isFinal");

-- CreateIndex
CREATE INDEX "KnockoutPredictionScore_fixtureId_isFinal_idx" ON "KnockoutPredictionScore"("fixtureId", "isFinal");

-- CreateIndex
CREATE INDEX "KnockoutPredictionScore_points_idx" ON "KnockoutPredictionScore"("points");

-- CreateIndex
CREATE INDEX "Team_fifaRank_idx" ON "Team"("fifaRank");

-- AddForeignKey
ALTER TABLE "KnockoutFixture" ADD CONSTRAINT "KnockoutFixture_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutFixture" ADD CONSTRAINT "KnockoutFixture_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutFixture" ADD CONSTRAINT "KnockoutFixture_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutBracket" ADD CONSTRAINT "KnockoutBracket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutBracket" ADD CONSTRAINT "KnockoutBracket_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "KnockoutGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPick" ADD CONSTRAINT "KnockoutPick_bracketId_fkey" FOREIGN KEY ("bracketId") REFERENCES "KnockoutBracket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPick" ADD CONSTRAINT "KnockoutPick_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "KnockoutFixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPick" ADD CONSTRAINT "KnockoutPick_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPick" ADD CONSTRAINT "KnockoutPick_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPick" ADD CONSTRAINT "KnockoutPick_advancingTeamId_fkey" FOREIGN KEY ("advancingTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPredictionScore" ADD CONSTRAINT "KnockoutPredictionScore_pickId_fkey" FOREIGN KEY ("pickId") REFERENCES "KnockoutPick"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPredictionScore" ADD CONSTRAINT "KnockoutPredictionScore_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "KnockoutFixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutPredictionScore" ADD CONSTRAINT "KnockoutPredictionScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- All matches on the same calendar day share one deadline: 30 minutes before the first match.
UPDATE "MatchDay" AS day
SET
    "predictionsCloseAt" = day."firstMatchStartsAt" - INTERVAL '30 minutes',
    "status" = CASE
        WHEN NOT EXISTS (
            SELECT 1 FROM "Match" AS match
            WHERE match."matchDayId" = day."id" AND match."status" <> 'FINISHED'
        ) THEN 'FINISHED'::"MatchDayStatus"
        WHEN EXISTS (
            SELECT 1 FROM "Match" AS match
            WHERE match."matchDayId" = day."id" AND match."status" = 'LIVE'
        ) THEN 'IN_PROGRESS'::"MatchDayStatus"
        WHEN day."firstMatchStartsAt" - INTERVAL '30 minutes' > NOW()
            THEN 'OPEN'::"MatchDayStatus"
        ELSE 'CLOSED'::"MatchDayStatus"
    END;
