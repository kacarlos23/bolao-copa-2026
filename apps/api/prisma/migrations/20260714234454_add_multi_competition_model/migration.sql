-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('NATIONAL_TEAM', 'CLUB');

-- CreateEnum
CREATE TYPE "CompetitionSeasonStatus" AS ENUM ('DRAFT', 'ACTIVE', 'FINISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('LEAGUE', 'GROUP', 'KNOCKOUT');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "PoolMembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "PoolMembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ProviderEntityType" AS ENUM ('COMPETITION', 'COMPETITION_SEASON', 'STAGE', 'ROUND', 'TEAM', 'MATCH');

-- AlterTable
ALTER TABLE "KnockoutBracket" ADD COLUMN     "poolSeasonId" TEXT;

-- AlterTable
ALTER TABLE "KnockoutFixture" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "KnockoutGeneration" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "predictionClosesAt" TIMESTAMP(3),
ADD COLUMN     "roundId" TEXT,
ADD COLUMN     "seasonId" TEXT,
ADD COLUMN     "stageId" TEXT;

-- AlterTable
ALTER TABLE "MatchDay" ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "Prediction" ADD COLUMN     "poolSeasonId" TEXT;

-- AlterTable
ALTER TABLE "PredictionScore" ADD COLUMN     "poolSeasonId" TEXT;

-- AlterTable
ALTER TABLE "RankingSnapshot" ADD COLUMN     "poolSeasonId" TEXT,
ADD COLUMN     "roundId" TEXT,
ADD COLUMN     "seasonId" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "crestUrl" TEXT,
ADD COLUMN     "type" "TeamType";

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionSeason" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "timezone" TEXT NOT NULL,
    "status" "CompetitionSeasonStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "capabilities" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stage" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StageType" NOT NULL,
    "order" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonTeam" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seed" INTEGER,
    "groupName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pool" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolMembership" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PoolMembershipRole" NOT NULL DEFAULT 'MEMBER',
    "status" "PoolMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolSeason" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "scoringRuleSetId" TEXT,
    "scoreableFromRound" INTEGER,
    "historicalMatchesScoreable" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringRuleSet" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "tieBreakers" JSONB,
    "effectiveAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoringRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEntityMapping" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" "ProviderEntityType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "seasonId" TEXT,
    "sourceUrl" TEXT,
    "collectedAt" TIMESTAMP(3),
    "checksum" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderEntityMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Competition_slug_key" ON "Competition"("slug");

-- CreateIndex
CREATE INDEX "Competition_name_idx" ON "Competition"("name");

-- CreateIndex
CREATE INDEX "CompetitionSeason_competitionId_status_idx" ON "CompetitionSeason"("competitionId", "status");

-- CreateIndex
CREATE INDEX "CompetitionSeason_status_startsAt_idx" ON "CompetitionSeason"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionSeason_competitionId_slug_key" ON "CompetitionSeason"("competitionId", "slug");

-- CreateIndex
CREATE INDEX "Stage_seasonId_type_idx" ON "Stage"("seasonId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_seasonId_slug_key" ON "Stage"("seasonId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Stage_seasonId_order_key" ON "Stage"("seasonId", "order");

-- CreateIndex
CREATE INDEX "Round_seasonId_status_startsAt_idx" ON "Round"("seasonId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Round_stageId_status_startsAt_idx" ON "Round"("stageId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Round_stageId_order_key" ON "Round"("stageId", "order");

-- CreateIndex
CREATE INDEX "SeasonTeam_teamId_seasonId_idx" ON "SeasonTeam"("teamId", "seasonId");

-- CreateIndex
CREATE INDEX "SeasonTeam_seasonId_groupName_idx" ON "SeasonTeam"("seasonId", "groupName");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonTeam_seasonId_teamId_key" ON "SeasonTeam"("seasonId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Pool_slug_key" ON "Pool"("slug");

-- CreateIndex
CREATE INDEX "Pool_name_idx" ON "Pool"("name");

-- CreateIndex
CREATE INDEX "PoolMembership_poolId_status_idx" ON "PoolMembership"("poolId", "status");

-- CreateIndex
CREATE INDEX "PoolMembership_userId_status_idx" ON "PoolMembership"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PoolMembership_poolId_userId_key" ON "PoolMembership"("poolId", "userId");

-- CreateIndex
CREATE INDEX "PoolSeason_seasonId_idx" ON "PoolSeason"("seasonId");

-- CreateIndex
CREATE INDEX "PoolSeason_scoringRuleSetId_idx" ON "PoolSeason"("scoringRuleSetId");

-- CreateIndex
CREATE UNIQUE INDEX "PoolSeason_poolId_seasonId_key" ON "PoolSeason"("poolId", "seasonId");

-- CreateIndex
CREATE INDEX "ScoringRuleSet_effectiveAt_idx" ON "ScoringRuleSet"("effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringRuleSet_key_version_key" ON "ScoringRuleSet"("key", "version");

-- CreateIndex
CREATE INDEX "ProviderEntityMapping_seasonId_entityType_idx" ON "ProviderEntityMapping"("seasonId", "entityType");

-- CreateIndex
CREATE INDEX "ProviderEntityMapping_entityType_internalId_idx" ON "ProviderEntityMapping"("entityType", "internalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEntityMapping_provider_entityType_externalId_key" ON "ProviderEntityMapping"("provider", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "KnockoutBracket_poolSeasonId_userId_idx" ON "KnockoutBracket"("poolSeasonId", "userId");

-- CreateIndex
CREATE INDEX "KnockoutFixture_seasonId_stage_status_startsAt_idx" ON "KnockoutFixture"("seasonId", "stage", "status", "startsAt");

-- CreateIndex
CREATE INDEX "KnockoutGeneration_seasonId_mode_status_idx" ON "KnockoutGeneration"("seasonId", "mode", "status");

-- CreateIndex
CREATE INDEX "Match_seasonId_status_startsAt_idx" ON "Match"("seasonId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Match_seasonId_roundId_status_startsAt_idx" ON "Match"("seasonId", "roundId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Match_stageId_startsAt_idx" ON "Match"("stageId", "startsAt");

-- CreateIndex
CREATE INDEX "Match_roundId_startsAt_idx" ON "Match"("roundId", "startsAt");

-- CreateIndex
CREATE INDEX "MatchDay_seasonId_date_idx" ON "MatchDay"("seasonId", "date");

-- CreateIndex
CREATE INDEX "MatchDay_seasonId_status_predictionsCloseAt_idx" ON "MatchDay"("seasonId", "status", "predictionsCloseAt");

-- CreateIndex
CREATE INDEX "Prediction_poolSeasonId_matchId_idx" ON "Prediction"("poolSeasonId", "matchId");

-- CreateIndex
CREATE INDEX "Prediction_poolSeasonId_userId_idx" ON "Prediction"("poolSeasonId", "userId");

-- CreateIndex
CREATE INDEX "PredictionScore_poolSeasonId_userId_isFinal_idx" ON "PredictionScore"("poolSeasonId", "userId", "isFinal");

-- CreateIndex
CREATE INDEX "PredictionScore_poolSeasonId_matchId_isFinal_idx" ON "PredictionScore"("poolSeasonId", "matchId", "isFinal");

-- CreateIndex
CREATE INDEX "RankingSnapshot_seasonId_roundId_calculatedAt_idx" ON "RankingSnapshot"("seasonId", "roundId", "calculatedAt");

-- CreateIndex
CREATE INDEX "RankingSnapshot_poolSeasonId_roundId_calculatedAt_idx" ON "RankingSnapshot"("poolSeasonId", "roundId", "calculatedAt");

-- AddForeignKey
ALTER TABLE "CompetitionSeason" ADD CONSTRAINT "CompetitionSeason_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stage" ADD CONSTRAINT "Stage_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonTeam" ADD CONSTRAINT "SeasonTeam_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonTeam" ADD CONSTRAINT "SeasonTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMembership" ADD CONSTRAINT "PoolMembership_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolMembership" ADD CONSTRAINT "PoolMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSeason" ADD CONSTRAINT "PoolSeason_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSeason" ADD CONSTRAINT "PoolSeason_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoolSeason" ADD CONSTRAINT "PoolSeason_scoringRuleSetId_fkey" FOREIGN KEY ("scoringRuleSetId") REFERENCES "ScoringRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEntityMapping" ADD CONSTRAINT "ProviderEntityMapping_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchDay" ADD CONSTRAINT "MatchDay_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prediction" ADD CONSTRAINT "Prediction_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictionScore" ADD CONSTRAINT "PredictionScore_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutFixture" ADD CONSTRAINT "KnockoutFixture_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutGeneration" ADD CONSTRAINT "KnockoutGeneration_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnockoutBracket" ADD CONSTRAINT "KnockoutBracket_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;
