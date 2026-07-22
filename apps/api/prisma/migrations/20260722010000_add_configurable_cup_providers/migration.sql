-- Prompt 3 expand-only provider configuration and knockout import support.
ALTER TYPE "ProviderSyncType" ADD VALUE 'STRUCTURE';
ALTER TYPE "ProviderSyncType" ADD VALUE 'TIES';
ALTER TYPE "ProviderSyncRunStatus" ADD VALUE 'VERIFIED';
ALTER TYPE "SyncQuarantineReason" ADD VALUE 'AMBIGUOUS_TEAM';
ALTER TYPE "SyncQuarantineReason" ADD VALUE 'AMBIGUOUS_STAGE';
ALTER TYPE "SyncQuarantineReason" ADD VALUE 'AMBIGUOUS_ROUND';
ALTER TYPE "SyncQuarantineReason" ADD VALUE 'AMBIGUOUS_TIE';
ALTER TYPE "SyncQuarantineReason" ADD VALUE 'AMBIGUOUS_KICKOFF';
ALTER TYPE "SyncQuarantineReason" ADD VALUE 'AMBIGUOUS_QUALIFIER';
ALTER TYPE "AuditAction" ADD VALUE 'SEASON_PROVIDER_CONFIG_CHANGED';

CREATE TYPE "ProviderSyncMode" AS ENUM ('DRY_RUN', 'DIFF', 'APPLY', 'VERIFY');

ALTER TABLE "Team"
  ADD COLUMN "countryCode" TEXT;

ALTER TABLE "TeamProfileSnapshot"
  ADD COLUMN "countryCode" TEXT,
  ADD COLUMN "federation" TEXT,
  ADD COLUMN "providerMetadata" JSONB;

ALTER TABLE "Match"
  ADD COLUMN "venueName" TEXT,
  ADD COLUMN "venueCity" TEXT,
  ADD COLUMN "venueCountryCode" TEXT;

ALTER TABLE "ProviderEntityMapping"
  ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'legacy';

UPDATE "ProviderEntityMapping"
SET "scopeKey" = CASE
  WHEN "seasonId" IS NULL THEN 'global'
  ELSE 'season:' || "seasonId"
END;

CREATE UNIQUE INDEX "ProviderEntityMapping_provider_scopeKey_entityType_externalId_key"
  ON "ProviderEntityMapping"("provider", "scopeKey", "entityType", "externalId");

ALTER TABLE "ProviderSyncRun"
  ADD COLUMN "mode" "ProviderSyncMode" NOT NULL DEFAULT 'APPLY',
  ADD COLUMN "collectedAt" TIMESTAMP(3);

CREATE TABLE "SeasonProviderConfig" (
  "id" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 1,
  "enabledTypes" "ProviderSyncType"[] NOT NULL,
  "cadenceSeconds" INTEGER NOT NULL DEFAULT 300,
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "includeProfiles" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL,
  "provenance" TEXT NOT NULL,
  "settings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SeasonProviderConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeasonProviderConfig_priority_check" CHECK ("priority" BETWEEN 1 AND 100),
  CONSTRAINT "SeasonProviderConfig_cadence_check" CHECK ("cadenceSeconds" BETWEEN 5 AND 86400),
  CONSTRAINT "SeasonProviderConfig_timeout_check" CHECK ("timeoutMs" BETWEEN 1000 AND 180000),
  CONSTRAINT "SeasonProviderConfig_types_check" CHECK (cardinality("enabledTypes") > 0),
  CONSTRAINT "SeasonProviderConfig_text_check" CHECK (
    length(btrim("providerKey")) > 0
    AND length(btrim("source")) > 0
    AND length(btrim("provenance")) > 0
  )
);

CREATE UNIQUE INDEX "SeasonProviderConfig_seasonId_providerKey_key"
  ON "SeasonProviderConfig"("seasonId", "providerKey");
CREATE INDEX "SeasonProviderConfig_active_priority_seasonId_idx"
  ON "SeasonProviderConfig"("active", "priority", "seasonId");

ALTER TABLE "SeasonProviderConfig" ADD CONSTRAINT "SeasonProviderConfig_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "CompetitionSeason"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Additively migrate the validated Prompt 1 metadata. The metadata is retained
-- as historical evidence and is no longer read for runtime provider selection.
INSERT INTO "SeasonProviderConfig" (
  "id",
  "seasonId",
  "providerKey",
  "priority",
  "enabledTypes",
  "cadenceSeconds",
  "timeoutMs",
  "active",
  "includeProfiles",
  "source",
  "provenance",
  "settings",
  "updatedAt"
)
SELECT
  'spc_' || md5(season."id" || ':' || (provider_entry.provider_json->>'key')),
  season."id",
  provider_entry.provider_json->>'key',
  COALESCE((provider_entry.provider_json->>'priority')::INTEGER, 1),
  ARRAY(
    SELECT jsonb_array_elements_text(provider_entry.provider_json->'types')::"ProviderSyncType"
  ),
  COALESCE((provider_entry.provider_json->>'cadenceSeconds')::INTEGER, 300),
  COALESCE((provider_entry.provider_json->>'timeoutMs')::INTEGER, 10000),
  COALESCE((provider_entry.provider_json->>'enabled')::BOOLEAN, true),
  COALESCE((provider_entry.provider_json->>'includeProfiles')::BOOLEAN, false),
  COALESCE(season."metadata"->'source'->>'source', 'metadata://prompt-1'),
  'prompt-1-metadata-migration',
  jsonb_build_object(
    'includeProfiles', COALESCE((provider_entry.provider_json->>'includeProfiles')::BOOLEAN, false),
    'migratedFromMetadata', true,
    'fallbackProviders', jsonb_build_array('csv', 'manual')
  ),
  CURRENT_TIMESTAMP
FROM "CompetitionSeason" season
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(season."metadata"->'providers') = 'array'
      THEN season."metadata"->'providers'
    ELSE '[]'::jsonb
  END
) AS provider_entry(provider_json)
WHERE provider_entry.provider_json ? 'key'
  AND jsonb_typeof(provider_entry.provider_json->'types') = 'array'
ON CONFLICT ("seasonId", "providerKey") DO NOTHING;

COMMENT ON TABLE "SeasonProviderConfig" IS
  'Single persisted source of provider selection for API, scheduler and administrative sync.';
COMMENT ON COLUMN "ProviderEntityMapping"."scopeKey" IS
  'Provider external-id namespace; new mappings use season:<seasonId> while legacy mappings remain readable.';
