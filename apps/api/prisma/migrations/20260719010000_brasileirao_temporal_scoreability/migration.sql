-- The Brasileirão pool opened at midnight in São Paulo on 2026-07-16.
-- Match time takes precedence over the legacy round gate so postponed fixtures
-- from earlier rounds can receive predictions when played after this cutoff.
UPDATE "PoolSeason" AS pool_season
SET
  "scoreableFrom" = TIMESTAMP(3) '2026-07-16 03:00:00.000',
  "scoreableFromRound" = NULL,
  "startsAtRound" = NULL,
  "metadata" = COALESCE(pool_season."metadata", '{}'::jsonb)
    || '{"policyVersion":"brasileirao-2026-v2-temporal"}'::jsonb,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CompetitionSeason" AS season
JOIN "Competition" AS competition ON competition."id" = season."competitionId"
JOIN "Pool" AS pool ON pool."slug" = 'bolao-do-trabalho'
WHERE pool_season."seasonId" = season."id"
  AND pool_season."poolId" = pool."id"
  AND season."slug" = 'brasileirao-serie-a-2026'
  AND competition."slug" = 'brasileirao-serie-a';

UPDATE "ScoringRuleSet" AS scoring
SET "effectiveAt" = TIMESTAMP(3) '2026-07-16 03:00:00.000'
WHERE EXISTS (
  SELECT 1
  FROM "PoolSeason" AS pool_season
  JOIN "CompetitionSeason" AS season ON season."id" = pool_season."seasonId"
  JOIN "Competition" AS competition ON competition."id" = season."competitionId"
  JOIN "Pool" AS pool ON pool."id" = pool_season."poolId"
  WHERE pool_season."scoringRuleSetId" = scoring."id"
    AND pool."slug" = 'bolao-do-trabalho'
    AND season."slug" = 'brasileirao-serie-a-2026'
    AND competition."slug" = 'brasileirao-serie-a'
);
