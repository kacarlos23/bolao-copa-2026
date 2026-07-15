-- Additive completion of the expand/migrate model. No legacy object is removed.
ALTER TABLE "PoolSeason"
  ADD COLUMN "scoreableFrom" TIMESTAMP(3),
  ADD COLUMN "startsAtRound" INTEGER;

ALTER TABLE "KnockoutPick" ADD COLUMN "poolSeasonId" TEXT;
ALTER TABLE "KnockoutGroupSimulationScore" ADD COLUMN "poolSeasonId" TEXT;
ALTER TABLE "KnockoutPredictionScore" ADD COLUMN "poolSeasonId" TEXT;

CREATE INDEX "PoolSeason_scoreableFrom_idx" ON "PoolSeason"("scoreableFrom");
CREATE UNIQUE INDEX "MatchDay_seasonId_date_key" ON "MatchDay"("seasonId", "date");
CREATE UNIQUE INDEX "Prediction_poolSeasonId_userId_matchId_key"
  ON "Prediction"("poolSeasonId", "userId", "matchId");
CREATE INDEX "KnockoutPick_poolSeasonId_bracketId_idx"
  ON "KnockoutPick"("poolSeasonId", "bracketId");
CREATE INDEX "KnockoutGroupSimulationScore_poolSeasonId_userId_idx"
  ON "KnockoutGroupSimulationScore"("poolSeasonId", "userId");
CREATE INDEX "KnockoutPredictionScore_poolSeasonId_userId_isFinal_idx"
  ON "KnockoutPredictionScore"("poolSeasonId", "userId", "isFinal");

ALTER TABLE "KnockoutPick"
  ADD CONSTRAINT "KnockoutPick_poolSeasonId_fkey"
  FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnockoutGroupSimulationScore"
  ADD CONSTRAINT "KnockoutGroupSimulationScore_poolSeasonId_fkey"
  FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnockoutPredictionScore"
  ADD CONSTRAINT "KnockoutPredictionScore_poolSeasonId_fkey"
  FOREIGN KEY ("poolSeasonId") REFERENCES "PoolSeason"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Relational hierarchy must not cross seasons.
CREATE UNIQUE INDEX "Stage_id_seasonId_key" ON "Stage"("id", "seasonId");
CREATE UNIQUE INDEX "Round_id_stageId_seasonId_key"
  ON "Round"("id", "stageId", "seasonId");

ALTER TABLE "Round"
  ADD CONSTRAINT "Round_stageId_seasonId_fkey"
  FOREIGN KEY ("stageId", "seasonId") REFERENCES "Stage"("id", "seasonId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Match"
  ADD CONSTRAINT "Match_roundId_stageId_seasonId_fkey"
  FOREIGN KEY ("roundId", "stageId", "seasonId")
  REFERENCES "Round"("id", "stageId", "seasonId")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Match"
  ADD CONSTRAINT "Match_context_shape_check"
  CHECK (
    ("roundId" IS NULL OR ("stageId" IS NOT NULL AND "seasonId" IS NOT NULL))
    AND ("stageId" IS NULL OR "seasonId" IS NOT NULL)
  );

-- PoolSeason and sporting entities have independent FKs; a trigger enforces the
-- cross-table invariant that both point to the same CompetitionSeason.
CREATE FUNCTION "validate_pool_season_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_season_id TEXT;
  entity_season_id TEXT;
  related_pool_season_id TEXT;
  related_match_id TEXT;
BEGIN
  IF NEW."poolSeasonId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "seasonId" INTO expected_season_id
  FROM "PoolSeason" WHERE "id" = NEW."poolSeasonId";
  IF expected_season_id IS NULL THEN
    RAISE EXCEPTION 'pool season context not found' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'Prediction' THEN
    SELECT "seasonId" INTO entity_season_id FROM "Match" WHERE "id" = NEW."matchId";
  ELSIF TG_TABLE_NAME = 'PredictionScore' THEN
    SELECT "seasonId" INTO entity_season_id FROM "Match" WHERE "id" = NEW."matchId";
    SELECT "poolSeasonId", "matchId" INTO related_pool_season_id, related_match_id
    FROM "Prediction" WHERE "id" = NEW."predictionId";
    IF related_pool_season_id IS DISTINCT FROM NEW."poolSeasonId"
       OR related_match_id IS DISTINCT FROM NEW."matchId" THEN
      RAISE EXCEPTION 'prediction score context differs from prediction'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'KnockoutBracket' THEN
    SELECT "seasonId" INTO entity_season_id
    FROM "KnockoutGeneration" WHERE "id" = NEW."generationId";
  ELSIF TG_TABLE_NAME = 'KnockoutPick' THEN
    SELECT "seasonId" INTO entity_season_id
    FROM "KnockoutFixture" WHERE "id" = NEW."fixtureId";
    SELECT "poolSeasonId" INTO related_pool_season_id
    FROM "KnockoutBracket" WHERE "id" = NEW."bracketId";
    IF related_pool_season_id IS DISTINCT FROM NEW."poolSeasonId" THEN
      RAISE EXCEPTION 'knockout pick context differs from bracket'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'KnockoutGroupSimulationScore' THEN
    SELECT "seasonId" INTO entity_season_id FROM "Match" WHERE "id" = NEW."matchId";
    IF NOT EXISTS (
      SELECT 1 FROM "KnockoutGeneration"
      WHERE "id" = NEW."generationId" AND "seasonId" = expected_season_id
    ) THEN
      RAISE EXCEPTION 'simulation generation crosses season' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'KnockoutPredictionScore' THEN
    SELECT "seasonId" INTO entity_season_id
    FROM "KnockoutFixture" WHERE "id" = NEW."fixtureId";
    SELECT "poolSeasonId" INTO related_pool_season_id
    FROM "KnockoutPick" WHERE "id" = NEW."pickId";
    IF related_pool_season_id IS DISTINCT FROM NEW."poolSeasonId" THEN
      RAISE EXCEPTION 'knockout score context differs from pick'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported scope trigger table %', TG_TABLE_NAME;
  END IF;

  IF entity_season_id IS NULL OR entity_season_id IS DISTINCT FROM expected_season_id THEN
    RAISE EXCEPTION 'entity crosses competition season' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Prediction_validate_pool_season_scope"
BEFORE INSERT OR UPDATE OF "poolSeasonId", "matchId" ON "Prediction"
FOR EACH ROW EXECUTE FUNCTION "validate_pool_season_scope"();
CREATE TRIGGER "PredictionScore_validate_pool_season_scope"
BEFORE INSERT OR UPDATE OF "poolSeasonId", "matchId", "predictionId" ON "PredictionScore"
FOR EACH ROW EXECUTE FUNCTION "validate_pool_season_scope"();
CREATE TRIGGER "KnockoutBracket_validate_pool_season_scope"
BEFORE INSERT OR UPDATE OF "poolSeasonId", "generationId" ON "KnockoutBracket"
FOR EACH ROW EXECUTE FUNCTION "validate_pool_season_scope"();
CREATE TRIGGER "KnockoutPick_validate_pool_season_scope"
BEFORE INSERT OR UPDATE OF "poolSeasonId", "fixtureId", "bracketId" ON "KnockoutPick"
FOR EACH ROW EXECUTE FUNCTION "validate_pool_season_scope"();
CREATE TRIGGER "KnockoutGroupSimulationScore_validate_pool_season_scope"
BEFORE INSERT OR UPDATE OF "poolSeasonId", "matchId", "generationId"
ON "KnockoutGroupSimulationScore"
FOR EACH ROW EXECUTE FUNCTION "validate_pool_season_scope"();
CREATE TRIGGER "KnockoutPredictionScore_validate_pool_season_scope"
BEFORE INSERT OR UPDATE OF "poolSeasonId", "fixtureId", "pickId"
ON "KnockoutPredictionScore"
FOR EACH ROW EXECUTE FUNCTION "validate_pool_season_scope"();

CREATE FUNCTION "validate_ranking_snapshot_scope"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_season_id TEXT;
  round_season_id TEXT;
BEGIN
  IF NEW."poolSeasonId" IS NOT NULL THEN
    SELECT "seasonId" INTO expected_season_id
    FROM "PoolSeason" WHERE "id" = NEW."poolSeasonId";
    IF NEW."seasonId" IS NULL OR NEW."seasonId" IS DISTINCT FROM expected_season_id THEN
      RAISE EXCEPTION 'ranking snapshot crosses competition season' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."roundId" IS NOT NULL THEN
    SELECT "seasonId" INTO round_season_id FROM "Round" WHERE "id" = NEW."roundId";
    IF NEW."seasonId" IS NULL OR NEW."seasonId" IS DISTINCT FROM round_season_id THEN
      RAISE EXCEPTION 'ranking snapshot round crosses competition season'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "RankingSnapshot_validate_scope"
BEFORE INSERT OR UPDATE OF "seasonId", "poolSeasonId", "roundId" ON "RankingSnapshot"
FOR EACH ROW EXECUTE FUNCTION "validate_ranking_snapshot_scope"();
