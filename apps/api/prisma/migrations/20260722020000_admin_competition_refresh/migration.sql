-- Enable one-click, provider-driven administrative refresh for every existing
-- competition season. Public feature flags remain untouched and fail closed.

INSERT INTO "SeasonProviderConfig" (
  "id", "seasonId", "providerKey", "priority", "enabledTypes",
  "cadenceSeconds", "timeoutMs", "active", "includeProfiles",
  "source", "provenance", "settings", "updatedAt"
)
SELECT
  'spc_' || md5(season."id" || ':cbf-official'),
  season."id",
  'cbf-official',
  1,
  ARRAY['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS']::"ProviderSyncType"[],
  300,
  20000,
  true,
  true,
  'https://www.cbf.com.br/futebol-brasileiro/tabelas/campeonato-brasileiro/serie-a/2026',
  'admin-competition-refresh-migration',
  jsonb_build_object(
    'competition', 'SERIE_A',
    'year', 2026,
    'collectionStrategy', 'LIVE_CBF_SERIE_A_2026',
    'fallbackProviders', jsonb_build_array('csv', 'manual')
  ),
  CURRENT_TIMESTAMP
FROM "CompetitionSeason" season
JOIN "Competition" competition ON competition."id" = season."competitionId"
WHERE competition."slug" = 'brasileirao-serie-a'
  AND season."slug" = 'brasileirao-serie-a-2026'
ON CONFLICT ("seasonId", "providerKey") DO UPDATE SET
  "enabledTypes" = EXCLUDED."enabledTypes",
  "timeoutMs" = EXCLUDED."timeoutMs",
  "active" = true,
  "includeProfiles" = true,
  "source" = EXCLUDED."source",
  "provenance" = EXCLUDED."provenance",
  "settings" = EXCLUDED."settings",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "SeasonProviderConfig" (
  "id", "seasonId", "providerKey", "priority", "enabledTypes",
  "cadenceSeconds", "timeoutMs", "active", "includeProfiles",
  "source", "provenance", "settings", "updatedAt"
)
SELECT
  'spc_' || md5(season."id" || ':fifa-official'),
  season."id",
  'fifa-official',
  1,
  ARRAY['TEAMS', 'SCHEDULE', 'RESULTS']::"ProviderSyncType"[],
  300,
  20000,
  true,
  false,
  'https://api.fifa.com/api/v3/calendar/matches?idSeason=285023&idCompetition=17&count=500&language=pt',
  'admin-competition-refresh-migration',
  jsonb_build_object(
    'competition', 'world-cup',
    'year', 2026,
    'collectionStrategy', 'LIVE_FIFA_WORLD_CUP_2026',
    'legacyKnockoutAdapter', true,
    'fallbackProviders', jsonb_build_array('manual')
  ),
  CURRENT_TIMESTAMP
FROM "CompetitionSeason" season
JOIN "Competition" competition ON competition."id" = season."competitionId"
WHERE competition."slug" = 'world-cup'
  AND season."slug" = 'world-cup-2026'
ON CONFLICT ("seasonId", "providerKey") DO UPDATE SET
  "enabledTypes" = EXCLUDED."enabledTypes",
  "timeoutMs" = EXCLUDED."timeoutMs",
  "active" = true,
  "includeProfiles" = false,
  "source" = EXCLUDED."source",
  "provenance" = EXCLUDED."provenance",
  "settings" = EXCLUDED."settings",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "SeasonProviderConfig" config
SET
  "active" = false,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CompetitionSeason" season
JOIN "Competition" competition ON competition."id" = season."competitionId"
WHERE config."seasonId" = season."id"
  AND competition."slug" = 'world-cup'
  AND season."slug" = 'world-cup-2026'
  AND config."providerKey" = 'ge';

UPDATE "SeasonProviderConfig" config
SET
  "settings" = jsonb_set(
    COALESCE(config."settings", '{}'::jsonb),
    '{collectionStrategy}',
    '"LIVE_SUDAMERICANA_2026"'::jsonb,
    true
  ),
  "timeoutMs" = GREATEST(config."timeoutMs", 20000),
  "source" = 'https://www.conmebol.com/documentos/manual-de-clubes-conmebol-sudamericana-2026/',
  "provenance" = 'admin-competition-refresh-migration',
  "updatedAt" = CURRENT_TIMESTAMP
FROM "CompetitionSeason" season
JOIN "Competition" competition ON competition."id" = season."competitionId"
WHERE config."seasonId" = season."id"
  AND config."providerKey" = 'conmebol-official'
  AND competition."slug" = 'conmebol-sudamericana'
  AND season."slug" = 'conmebol-sudamericana-2026';

COMMENT ON TABLE "SeasonProviderConfig" IS
  'Administrative refresh control plane: provider selection is data-driven and independent from public feature flags.';
