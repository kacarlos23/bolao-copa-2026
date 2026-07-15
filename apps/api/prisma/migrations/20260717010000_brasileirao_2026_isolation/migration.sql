-- Match days are scoped by season. A global date key would make two
-- competitions on the same civil day collide.
DROP INDEX IF EXISTS "MatchDay_date_key";

-- League reads filter by season and round without requiring a status.
CREATE INDEX "Match_seasonId_roundId_startsAt_idx"
ON "Match"("seasonId", "roundId", "startsAt");
