-- Expand-only knockout series domain. Legacy knockout tables and scores remain untouched.
CREATE TYPE "TieStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'DECIDED', 'CANCELLED');
CREATE TYPE "TieDecisionMethod" AS ENUM (
  'AGGREGATE',
  'EXTRA_TIME',
  'PENALTIES',
  'WALKOVER',
  'ADMINISTRATIVE'
);

ALTER TYPE "ProviderEntityType" ADD VALUE 'TIE';

CREATE TABLE "Tie" (
  "id" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "stageId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "teamAId" TEXT NOT NULL,
  "teamBId" TEXT NOT NULL,
  "expectedLegs" INTEGER NOT NULL,
  "status" "TieStatus" NOT NULL DEFAULT 'SCHEDULED',
  "decisionMethod" "TieDecisionMethod",
  "winnerTeamId" TEXT,
  "aggregateTeamAScore" INTEGER,
  "aggregateTeamBScore" INTEGER,
  "decidedAt" TIMESTAMP(3),
  "lastRecomputedAt" TIMESTAMP(3),
  "provenance" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Tie_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Tie_expected_legs_check" CHECK ("expectedLegs" IN (1, 2)),
  CONSTRAINT "Tie_order_check" CHECK ("order" > 0),
  CONSTRAINT "Tie_identity_check" CHECK ("teamAId" <> "teamBId"),
  CONSTRAINT "Tie_text_fields_check" CHECK (
    length(btrim("key")) > 0 AND length(btrim("provenance")) > 0
  ),
  CONSTRAINT "Tie_winner_check" CHECK (
    "winnerTeamId" IS NULL OR "winnerTeamId" IN ("teamAId", "teamBId")
  ),
  CONSTRAINT "Tie_aggregate_pair_check" CHECK (
    ("aggregateTeamAScore" IS NULL AND "aggregateTeamBScore" IS NULL)
    OR (
      "aggregateTeamAScore" IS NOT NULL
      AND "aggregateTeamBScore" IS NOT NULL
      AND "aggregateTeamAScore" >= 0
      AND "aggregateTeamBScore" >= 0
    )
  ),
  CONSTRAINT "Tie_decision_state_check" CHECK (
    (
      "status" = 'DECIDED'
      AND "winnerTeamId" IS NOT NULL
      AND "decisionMethod" IS NOT NULL
      AND "decidedAt" IS NOT NULL
    )
    OR (
      "status" <> 'DECIDED'
      AND "winnerTeamId" IS NULL
      AND "decisionMethod" IS NULL
      AND "decidedAt" IS NULL
    )
  ),
  CONSTRAINT "Tie_sport_decision_aggregate_check" CHECK (
    "decisionMethod" IS NULL
    OR "decisionMethod" IN ('WALKOVER', 'ADMINISTRATIVE')
    OR ("aggregateTeamAScore" IS NOT NULL AND "aggregateTeamBScore" IS NOT NULL)
  ),
  CONSTRAINT "Tie_sport_winner_consistency_check" CHECK (
    "decisionMethod" IS NULL
    OR "decisionMethod" IN ('WALKOVER', 'ADMINISTRATIVE')
    OR (
      "decisionMethod" IN ('AGGREGATE', 'EXTRA_TIME')
      AND (
        ("aggregateTeamAScore" > "aggregateTeamBScore" AND "winnerTeamId" = "teamAId")
        OR ("aggregateTeamBScore" > "aggregateTeamAScore" AND "winnerTeamId" = "teamBId")
      )
    )
    OR (
      "decisionMethod" = 'PENALTIES'
      AND "aggregateTeamAScore" = "aggregateTeamBScore"
    )
  )
);

CREATE UNIQUE INDEX "Tie_seasonId_key_key" ON "Tie"("seasonId", "key");
CREATE UNIQUE INDEX "Tie_roundId_order_key" ON "Tie"("roundId", "order");
CREATE UNIQUE INDEX "Tie_id_seasonId_key" ON "Tie"("id", "seasonId");
CREATE UNIQUE INDEX "Tie_id_seasonId_stageId_roundId_key"
  ON "Tie"("id", "seasonId", "stageId", "roundId");
CREATE INDEX "Tie_seasonId_status_order_idx" ON "Tie"("seasonId", "status", "order");
CREATE INDEX "Tie_stageId_roundId_order_idx" ON "Tie"("stageId", "roundId", "order");
CREATE INDEX "Tie_teamAId_idx" ON "Tie"("teamAId");
CREATE INDEX "Tie_teamBId_idx" ON "Tie"("teamBId");
CREATE INDEX "Tie_winnerTeamId_idx" ON "Tie"("winnerTeamId");

ALTER TABLE "Tie" ADD CONSTRAINT "Tie_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "Stage"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_roundId_fkey"
  FOREIGN KEY ("roundId") REFERENCES "Round"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_stageId_seasonId_fkey"
  FOREIGN KEY ("stageId", "seasonId") REFERENCES "Stage"("id", "seasonId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_roundId_stageId_seasonId_fkey"
  FOREIGN KEY ("roundId", "stageId", "seasonId")
  REFERENCES "Round"("id", "stageId", "seasonId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_teamAId_fkey"
  FOREIGN KEY ("teamAId") REFERENCES "Team"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_teamBId_fkey"
  FOREIGN KEY ("teamBId") REFERENCES "Team"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_winnerTeamId_fkey"
  FOREIGN KEY ("winnerTeamId") REFERENCES "Team"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_seasonId_teamAId_fkey"
  FOREIGN KEY ("seasonId", "teamAId") REFERENCES "SeasonTeam"("seasonId", "teamId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Tie" ADD CONSTRAINT "Tie_seasonId_teamBId_fkey"
  FOREIGN KEY ("seasonId", "teamBId") REFERENCES "SeasonTeam"("seasonId", "teamId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "validate_tie_knockout_stage"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Stage"
    WHERE "id" = NEW."stageId" AND "seasonId" = NEW."seasonId" AND "type" = 'KNOCKOUT'
  ) THEN
    RAISE EXCEPTION 'tie must belong to a knockout stage' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Tie_validate_knockout_stage"
BEFORE INSERT OR UPDATE OF "stageId", "seasonId" ON "Tie"
FOR EACH ROW EXECUTE FUNCTION "validate_tie_knockout_stage"();

ALTER TABLE "Match"
  ADD COLUMN "tieId" TEXT,
  ADD COLUMN "legNumber" INTEGER,
  ADD COLUMN "regulationHomeScore" INTEGER,
  ADD COLUMN "regulationAwayScore" INTEGER,
  ADD COLUMN "extraTimeHomeScore" INTEGER,
  ADD COLUMN "extraTimeAwayScore" INTEGER,
  ADD COLUMN "penaltyHomeScore" INTEGER,
  ADD COLUMN "penaltyAwayScore" INTEGER;

CREATE UNIQUE INDEX "Match_tieId_legNumber_key" ON "Match"("tieId", "legNumber");
CREATE INDEX "Match_tieId_status_idx" ON "Match"("tieId", "status");

ALTER TABLE "Match" ADD CONSTRAINT "Match_tie_shape_check" CHECK (
  ("tieId" IS NULL AND "legNumber" IS NULL)
  OR (
    "tieId" IS NOT NULL
    AND "legNumber" IN (1, 2)
    AND "seasonId" IS NOT NULL
    AND "stageId" IS NOT NULL
    AND "roundId" IS NOT NULL
  )
);
ALTER TABLE "Match" ADD CONSTRAINT "Match_regulation_score_pair_check" CHECK (
  ("regulationHomeScore" IS NULL AND "regulationAwayScore" IS NULL)
  OR (
    "regulationHomeScore" IS NOT NULL
    AND "regulationAwayScore" IS NOT NULL
    AND "regulationHomeScore" >= 0
    AND "regulationAwayScore" >= 0
  )
);
ALTER TABLE "Match" ADD CONSTRAINT "Match_extra_time_score_pair_check" CHECK (
  ("extraTimeHomeScore" IS NULL AND "extraTimeAwayScore" IS NULL)
  OR (
    "extraTimeHomeScore" IS NOT NULL
    AND "extraTimeAwayScore" IS NOT NULL
    AND "extraTimeHomeScore" >= 0
    AND "extraTimeAwayScore" >= 0
    AND "regulationHomeScore" IS NOT NULL
    AND "regulationAwayScore" IS NOT NULL
  )
);
ALTER TABLE "Match" ADD CONSTRAINT "Match_penalty_score_pair_check" CHECK (
  ("penaltyHomeScore" IS NULL AND "penaltyAwayScore" IS NULL)
  OR (
    "penaltyHomeScore" IS NOT NULL
    AND "penaltyAwayScore" IS NOT NULL
    AND "penaltyHomeScore" >= 0
    AND "penaltyAwayScore" >= 0
    AND "regulationHomeScore" IS NOT NULL
    AND "regulationAwayScore" IS NOT NULL
  )
);
ALTER TABLE "Match" ADD CONSTRAINT "Match_finished_tie_score_check" CHECK (
  "tieId" IS NULL
  OR "status" <> 'FINISHED'
  OR ("regulationHomeScore" IS NOT NULL AND "regulationAwayScore" IS NOT NULL)
);
ALTER TABLE "Match" ADD CONSTRAINT "Match_tieId_fkey"
  FOREIGN KEY ("tieId") REFERENCES "Tie"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_tie_context_fkey"
  FOREIGN KEY ("tieId", "seasonId", "stageId", "roundId")
  REFERENCES "Tie"("id", "seasonId", "stageId", "roundId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "validate_match_tie_membership"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tie_team_a_id TEXT;
  tie_team_b_id TEXT;
  tie_expected_legs INTEGER;
BEGIN
  IF NEW."tieId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "teamAId", "teamBId", "expectedLegs"
    INTO tie_team_a_id, tie_team_b_id, tie_expected_legs
  FROM "Tie" WHERE "id" = NEW."tieId";

  IF tie_team_a_id IS NULL THEN
    RAISE EXCEPTION 'tie context not found' USING ERRCODE = '23514';
  END IF;
  IF NEW."legNumber" > tie_expected_legs THEN
    RAISE EXCEPTION 'leg number exceeds expected legs' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (NEW."homeTeamId" = tie_team_a_id AND NEW."awayTeamId" = tie_team_b_id)
    OR (NEW."homeTeamId" = tie_team_b_id AND NEW."awayTeamId" = tie_team_a_id)
  ) THEN
    RAISE EXCEPTION 'match teams differ from tie teams' USING ERRCODE = '23514';
  END IF;
  IF (
    NEW."extraTimeHomeScore" IS NOT NULL OR NEW."penaltyHomeScore" IS NOT NULL
  ) AND NEW."legNumber" <> tie_expected_legs THEN
    RAISE EXCEPTION 'extra time and penalties belong to the deciding leg'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Match_validate_tie_membership"
BEFORE INSERT OR UPDATE OF
  "tieId", "legNumber", "seasonId", "stageId", "roundId",
  "homeTeamId", "awayTeamId", "extraTimeHomeScore", "penaltyHomeScore"
ON "Match"
FOR EACH ROW EXECUTE FUNCTION "validate_match_tie_membership"();

CREATE FUNCTION "validate_tie_attached_matches"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Match" match
    WHERE match."tieId" = NEW."id"
      AND (
        match."legNumber" > NEW."expectedLegs"
        OR NOT (
          (match."homeTeamId" = NEW."teamAId" AND match."awayTeamId" = NEW."teamBId")
          OR (match."homeTeamId" = NEW."teamBId" AND match."awayTeamId" = NEW."teamAId")
        )
      )
  ) THEN
    RAISE EXCEPTION 'tie update conflicts with attached matches' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Tie_validate_attached_matches"
BEFORE UPDATE OF "teamAId", "teamBId", "expectedLegs" ON "Tie"
FOR EACH ROW EXECUTE FUNCTION "validate_tie_attached_matches"();
