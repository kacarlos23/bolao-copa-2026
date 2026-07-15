-- Etapa 7 is additive: legacy score points/types are never recalculated here.
CREATE TABLE "ScoringRuleSetVersion" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "rules" JSONB NOT NULL,
  "checksum" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seasonId" TEXT,
  CONSTRAINT "ScoringRuleSetVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TieBreakerRuleSet" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "criteria" JSONB NOT NULL,
  "allowSharedPositions" BOOLEAN NOT NULL DEFAULT true,
  "checksum" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "seasonId" TEXT,
  CONSTRAINT "TieBreakerRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScoringRuleSetVersion_key_version_key" ON "ScoringRuleSetVersion"("key", "version");
CREATE UNIQUE INDEX "ScoringRuleSetVersion_checksum_key" ON "ScoringRuleSetVersion"("checksum");
CREATE INDEX "ScoringRuleSetVersion_seasonId_effectiveAt_idx" ON "ScoringRuleSetVersion"("seasonId", "effectiveAt");
CREATE UNIQUE INDEX "TieBreakerRuleSet_key_version_key" ON "TieBreakerRuleSet"("key", "version");
CREATE UNIQUE INDEX "TieBreakerRuleSet_checksum_key" ON "TieBreakerRuleSet"("checksum");
CREATE INDEX "TieBreakerRuleSet_seasonId_effectiveAt_idx" ON "TieBreakerRuleSet"("seasonId", "effectiveAt");

INSERT INTO "ScoringRuleSetVersion" ("id", "key", "name", "version", "rules", "checksum", "effectiveAt", "seasonId")
VALUES (
  'scoring-rule-set-version-15-3-1-0-v1',
  'classic-15-3-1-0',
  'Pontuação 15/3/1/0',
  1,
  '{"exactScore":15,"correctOutcome":3,"oneTeamGoals":1,"miss":0}'::jsonb,
  'classic-15-3-1-0:v1:15-3-1-0',
  '2026-06-11T00:00:00.000Z',
  NULL
) ON CONFLICT ("key", "version") DO NOTHING;

INSERT INTO "TieBreakerRuleSet" ("id", "key", "name", "version", "criteria", "allowSharedPositions", "checksum", "effectiveAt", "seasonId")
VALUES (
  'tie-breaker-classic-v1',
  'classic-ranking',
  'Desempate clássico',
  1,
  '[{"field":"points","direction":"desc","label":"Mais pontos"},{"field":"exactScores","direction":"desc","label":"Mais placares exatos"},{"field":"resultHits","direction":"desc","label":"Mais resultados corretos"},{"field":"oneGoalHits","direction":"desc","label":"Mais gols de uma equipe acertados"},{"field":"misses","direction":"asc","label":"Menos erros"}]'::jsonb,
  true,
  'classic-ranking:v1:shared-position',
  '2026-06-11T00:00:00.000Z',
  NULL
) ON CONFLICT ("key", "version") DO NOTHING;

ALTER TABLE "PoolSeason" ADD COLUMN "scoringRuleSetVersionId" TEXT;
ALTER TABLE "PoolSeason" ADD COLUMN "tieBreakerRuleSetId" TEXT;
UPDATE "PoolSeason"
SET "scoringRuleSetVersionId" = 'scoring-rule-set-version-15-3-1-0-v1',
    "tieBreakerRuleSetId" = 'tie-breaker-classic-v1'
WHERE "scoringRuleSetId" = 'scoring-rule-set-15-3-1-0-v1'
   OR "id" = 'pool-season-bolao-do-trabalho-world-cup-2026';
CREATE INDEX "PoolSeason_scoringRuleSetVersionId_idx" ON "PoolSeason"("scoringRuleSetVersionId");
CREATE INDEX "PoolSeason_tieBreakerRuleSetId_idx" ON "PoolSeason"("tieBreakerRuleSetId");

ALTER TABLE "PredictionScore" ADD COLUMN "scoringRuleSetVersionId" TEXT;
ALTER TABLE "PredictionScore" ADD COLUMN "scoringVersion" INTEGER;
ALTER TABLE "PredictionScore" ADD COLUMN "breakdown" JSONB;
ALTER TABLE "PredictionScore" ADD COLUMN "calculationKey" TEXT;
ALTER TABLE "PredictionScore" ADD COLUMN "resultRevision" TEXT;
UPDATE "PredictionScore" SET
  "scoringRuleSetVersionId" = 'scoring-rule-set-version-15-3-1-0-v1',
  "scoringVersion" = 1,
  "breakdown" = jsonb_build_object(
    'criterion', CASE "scoreType"::text WHEN 'RESULT' THEN 'CORRECT_OUTCOME' ELSE "scoreType"::text END,
    'awardedPoints', "points", 'historical', true,
    'rule', '{"exactScore":15,"correctOutcome":3,"oneTeamGoals":1,"miss":0}'::jsonb
  ),
  "calculationKey" = 'historical:' || "id",
  "resultRevision" = 'historical-preserved';
ALTER TABLE "PredictionScore" ALTER COLUMN "scoringRuleSetVersionId" SET NOT NULL;
ALTER TABLE "PredictionScore" ALTER COLUMN "scoringVersion" SET NOT NULL;
ALTER TABLE "PredictionScore" ALTER COLUMN "breakdown" SET NOT NULL;
ALTER TABLE "PredictionScore" ALTER COLUMN "calculationKey" SET NOT NULL;
ALTER TABLE "PredictionScore" ALTER COLUMN "resultRevision" SET NOT NULL;
CREATE INDEX "PredictionScore_scoringRuleSetVersionId_scoringVersion_idx" ON "PredictionScore"("scoringRuleSetVersionId", "scoringVersion");
CREATE UNIQUE INDEX "PredictionScore_predictionId_calculationKey_key" ON "PredictionScore"("predictionId", "calculationKey");

ALTER TABLE "KnockoutPredictionScore" ADD COLUMN "scoringRuleSetVersionId" TEXT;
ALTER TABLE "KnockoutPredictionScore" ADD COLUMN "scoringVersion" INTEGER;
ALTER TABLE "KnockoutPredictionScore" ADD COLUMN "breakdown" JSONB;
ALTER TABLE "KnockoutPredictionScore" ADD COLUMN "calculationKey" TEXT;
ALTER TABLE "KnockoutPredictionScore" ADD COLUMN "resultRevision" TEXT;
UPDATE "KnockoutPredictionScore" SET
  "scoringRuleSetVersionId" = 'scoring-rule-set-version-15-3-1-0-v1',
  "scoringVersion" = 1,
  "breakdown" = jsonb_build_object('criterion', "scoreType"::text, 'awardedPoints', "points", 'historical', true),
  "calculationKey" = 'historical:' || "id",
  "resultRevision" = 'historical-preserved';
ALTER TABLE "KnockoutPredictionScore" ALTER COLUMN "scoringRuleSetVersionId" SET NOT NULL;
ALTER TABLE "KnockoutPredictionScore" ALTER COLUMN "scoringVersion" SET NOT NULL;
ALTER TABLE "KnockoutPredictionScore" ALTER COLUMN "breakdown" SET NOT NULL;
ALTER TABLE "KnockoutPredictionScore" ALTER COLUMN "calculationKey" SET NOT NULL;
ALTER TABLE "KnockoutPredictionScore" ALTER COLUMN "resultRevision" SET NOT NULL;
CREATE INDEX "KnockoutPredictionScore_scoringRuleSetVersionId_scoringVersion_idx" ON "KnockoutPredictionScore"("scoringRuleSetVersionId", "scoringVersion");
CREATE UNIQUE INDEX "KnockoutPredictionScore_pickId_calculationKey_key" ON "KnockoutPredictionScore"("pickId", "calculationKey");

ALTER TABLE "RankingSnapshot" ADD COLUMN "misses" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RankingSnapshot" ADD COLUMN "snapshotKey" TEXT;
ALTER TABLE "RankingSnapshot" ADD COLUMN "sourceRevision" TEXT;
UPDATE "RankingSnapshot" SET "snapshotKey" = 'legacy:' || "id", "sourceRevision" = 'historical-preserved';
ALTER TABLE "RankingSnapshot" ALTER COLUMN "snapshotKey" SET NOT NULL;
ALTER TABLE "RankingSnapshot" ALTER COLUMN "sourceRevision" SET NOT NULL;
CREATE UNIQUE INDEX "RankingSnapshot_poolSeasonId_userId_snapshotKey_key" ON "RankingSnapshot"("poolSeasonId", "userId", "snapshotKey");

CREATE TABLE "ScoreRecomputationAudit" (
  "id" TEXT NOT NULL, "poolSeasonId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL, "sourceRevision" TEXT NOT NULL,
  "scoringRuleSetVersionId" TEXT NOT NULL, "before" JSONB, "after" JSONB,
  "reason" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScoreRecomputationAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScoreRecomputationAudit_idempotencyKey_key" ON "ScoreRecomputationAudit"("idempotencyKey");
CREATE INDEX "ScoreRecomputationAudit_poolSeasonId_targetType_targetId_createdAt_idx" ON "ScoreRecomputationAudit"("poolSeasonId", "targetType", "targetId", "createdAt");
CREATE INDEX "ScoreRecomputationAudit_userId_createdAt_idx" ON "ScoreRecomputationAudit"("userId", "createdAt");

CREATE TABLE "AchievementDefinition" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "version" INTEGER NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL, "rarity" TEXT NOT NULL, "criteria" JSONB NOT NULL,
  "checksum" TEXT NOT NULL, "seasonId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AchievementDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AchievementDefinition_key_version_key" ON "AchievementDefinition"("key", "version");
CREATE UNIQUE INDEX "AchievementDefinition_checksum_key" ON "AchievementDefinition"("checksum");
CREATE INDEX "AchievementDefinition_seasonId_key_idx" ON "AchievementDefinition"("seasonId", "key");

INSERT INTO "AchievementDefinition" ("id", "key", "version", "name", "description", "rarity", "criteria", "checksum", "seasonId") VALUES
('achievement-first-prediction-v1','FIRST_PREDICTION',1,'Primeiro palpite','Registrou o primeiro palpite na temporada.','COMMON','{"type":"predictionCount","minimum":1}','FIRST_PREDICTION:v1',NULL),
('achievement-first-exact-v1','FIRST_EXACT',1,'Na mosca','Acertou o primeiro placar exato em resultado final.','UNCOMMON','{"type":"finalScoreTypeCount","scoreType":"EXACT_SCORE","minimum":1}','FIRST_EXACT:v1',NULL),
('achievement-three-hit-streak-v1','THREE_HIT_STREAK',1,'Embalado','Conseguiu três acertos finais consecutivos.','RARE','{"type":"streak","streakType":"ANY_HIT","minimum":3}','THREE_HIT_STREAK:v1',NULL),
('achievement-round-leader-v1','ROUND_LEADER',1,'Líder da rodada','Terminou ou lidera provisoriamente uma rodada.','RARE','{"type":"roundLeader"}','ROUND_LEADER:v1',NULL),
('achievement-ranking-comeback-v1','RANKING_COMEBACK',1,'Virada no ranking','Subiu pelo menos três posições desde um snapshot persistido.','RARE','{"type":"rankingMovement","minimumDelta":3}','RANKING_COMEBACK:v1',NULL),
('achievement-complete-bracket-v1','COMPLETE_BRACKET',1,'Chave completa','Preencheu todos os confrontos disponíveis da chave.','UNCOMMON','{"type":"completeBracket"}','COMPLETE_BRACKET:v1',NULL)
ON CONFLICT ("key", "version") DO NOTHING;

CREATE TABLE "UserAchievement" (
  "id" TEXT NOT NULL, "poolSeasonId" TEXT NOT NULL, "userId" TEXT NOT NULL, "definitionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "progress" JSONB NOT NULL, "isProvisional" BOOLEAN NOT NULL DEFAULT false,
  "achievedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "sourceRevision" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserAchievement_idempotencyKey_key" ON "UserAchievement"("idempotencyKey");
CREATE UNIQUE INDEX "UserAchievement_poolSeasonId_userId_definitionId_key" ON "UserAchievement"("poolSeasonId", "userId", "definitionId");
CREATE INDEX "UserAchievement_poolSeasonId_userId_achievedAt_idx" ON "UserAchievement"("poolSeasonId", "userId", "achievedAt");

CREATE TABLE "Streak" (
  "id" TEXT NOT NULL, "poolSeasonId" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "currentCount" INTEGER NOT NULL, "bestCount" INTEGER NOT NULL, "lastEventKey" TEXT,
  "sourceRevision" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Streak_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Streak_poolSeasonId_userId_type_key" ON "Streak"("poolSeasonId", "userId", "type");
CREATE INDEX "Streak_poolSeasonId_type_bestCount_idx" ON "Streak"("poolSeasonId", "type", "bestCount");

CREATE TABLE "RankingMovement" (
  "id" TEXT NOT NULL, "poolSeasonId" TEXT NOT NULL, "roundId" TEXT, "userId" TEXT NOT NULL,
  "fromSnapshotId" TEXT NOT NULL, "toSnapshotId" TEXT NOT NULL, "fromRank" INTEGER NOT NULL,
  "toRank" INTEGER NOT NULL, "delta" INTEGER NOT NULL, "isProvisional" BOOLEAN NOT NULL DEFAULT false,
  "idempotencyKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankingMovement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RankingMovement_idempotencyKey_key" ON "RankingMovement"("idempotencyKey");
CREATE UNIQUE INDEX "RankingMovement_poolSeasonId_userId_fromSnapshotId_toSnapshotId_key" ON "RankingMovement"("poolSeasonId", "userId", "fromSnapshotId", "toSnapshotId");
CREATE INDEX "RankingMovement_poolSeasonId_userId_createdAt_idx" ON "RankingMovement"("poolSeasonId", "userId", "createdAt");

CREATE TABLE "UserPoolSeasonVisit" (
  "id" TEXT NOT NULL, "poolSeasonId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "lastSeenSnapshotId" TEXT, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPoolSeasonVisit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserPoolSeasonVisit_poolSeasonId_userId_key" ON "UserPoolSeasonVisit"("poolSeasonId", "userId");
CREATE INDEX "UserPoolSeasonVisit_userId_lastSeenAt_idx" ON "UserPoolSeasonVisit"("userId", "lastSeenAt");

CREATE TABLE "NotificationInbox" (
  "id" TEXT NOT NULL, "poolSeasonId" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "title" TEXT NOT NULL, "body" TEXT NOT NULL, "data" JSONB, "idempotencyKey" TEXT NOT NULL,
  "isProvisional" BOOLEAN NOT NULL DEFAULT false, "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationInbox_idempotencyKey_key" ON "NotificationInbox"("idempotencyKey");
CREATE INDEX "NotificationInbox_poolSeasonId_userId_readAt_availableAt_idx" ON "NotificationInbox"("poolSeasonId", "userId", "readAt", "availableAt");

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL, "poolSeasonId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true, "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false, "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursStart" TEXT, "quietHoursEnd" TEXT, "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationPreference_poolSeasonId_userId_key" ON "NotificationPreference"("poolSeasonId", "userId");

ALTER TABLE "OutboxEvent" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "OutboxEvent"("idempotencyKey");

ALTER TABLE "ScoringRuleSetVersion" ADD CONSTRAINT "ScoringRuleSetVersion_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TieBreakerRuleSet" ADD CONSTRAINT "TieBreakerRuleSet_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PoolSeason" ADD CONSTRAINT "PoolSeason_scoringRuleSetVersionId_fkey" FOREIGN KEY ("scoringRuleSetVersionId") REFERENCES "ScoringRuleSetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PoolSeason" ADD CONSTRAINT "PoolSeason_tieBreakerRuleSetId_fkey" FOREIGN KEY ("tieBreakerRuleSetId") REFERENCES "TieBreakerRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PredictionScore" ADD CONSTRAINT "PredictionScore_scoringRuleSetVersionId_fkey" FOREIGN KEY ("scoringRuleSetVersionId") REFERENCES "ScoringRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnockoutPredictionScore" ADD CONSTRAINT "KnockoutPredictionScore_scoringRuleSetVersionId_fkey" FOREIGN KEY ("scoringRuleSetVersionId") REFERENCES "ScoringRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScoreRecomputationAudit" ADD CONSTRAINT "ScoreRecomputationAudit_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreRecomputationAudit" ADD CONSTRAINT "ScoreRecomputationAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreRecomputationAudit" ADD CONSTRAINT "ScoreRecomputationAudit_scoringRuleSetVersionId_fkey" FOREIGN KEY ("scoringRuleSetVersionId") REFERENCES "ScoringRuleSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AchievementDefinition" ADD CONSTRAINT "AchievementDefinition_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "AchievementDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Streak" ADD CONSTRAINT "Streak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingMovement" ADD CONSTRAINT "RankingMovement_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingMovement" ADD CONSTRAINT "RankingMovement_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RankingMovement" ADD CONSTRAINT "RankingMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingMovement" ADD CONSTRAINT "RankingMovement_fromSnapshotId_fkey" FOREIGN KEY ("fromSnapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RankingMovement" ADD CONSTRAINT "RankingMovement_toSnapshotId_fkey" FOREIGN KEY ("toSnapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPoolSeasonVisit" ADD CONSTRAINT "UserPoolSeasonVisit_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPoolSeasonVisit" ADD CONSTRAINT "UserPoolSeasonVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPoolSeasonVisit" ADD CONSTRAINT "UserPoolSeasonVisit_lastSeenSnapshotId_fkey" FOREIGN KEY ("lastSeenSnapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationInbox" ADD CONSTRAINT "NotificationInbox_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationInbox" ADD CONSTRAINT "NotificationInbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_poolSeasonId_fkey" FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Immutable definitions: changes are new versions, never UPDATE/DELETE.
CREATE OR REPLACE FUNCTION "reject_immutable_stage7_row"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; create a new version', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ScoringRuleSetVersion_immutable" BEFORE UPDATE OR DELETE ON "ScoringRuleSetVersion" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_stage7_row"();
CREATE TRIGGER "TieBreakerRuleSet_immutable" BEFORE UPDATE OR DELETE ON "TieBreakerRuleSet" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_stage7_row"();
CREATE TRIGGER "AchievementDefinition_immutable" BEFORE UPDATE OR DELETE ON "AchievementDefinition" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_stage7_row"();
