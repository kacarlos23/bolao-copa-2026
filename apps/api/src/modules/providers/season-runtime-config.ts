import type { Prisma, ProviderSyncType } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';

export const configuredProviderTypeSchema = z.enum([
  'TEAMS',
  'STRUCTURE',
  'TIES',
  'SCHEDULE',
  'RESULTS',
  'STANDINGS',
]);

export const seasonProviderRuntimeConfigSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    priority: z.number().int().min(1).max(100).default(1),
    types: z.array(configuredProviderTypeSchema).min(1),
    enabled: z.boolean().default(true),
    cadenceSeconds: z.number().int().min(5).max(86_400).default(300),
    timeoutMs: z.number().int().min(1_000).max(180_000).default(10_000),
    includeProfiles: z.boolean().default(false),
    source: z.string().trim().min(1).max(500).default('config://season-provider'),
    provenance: z.string().trim().min(1).max(200).default('season-provider-config'),
    settings: z.record(z.unknown()).default({}),
  })
  .strict();

const legacySeasonRuntimeMetadataSchema = z
  .object({
    providers: z.array(seasonProviderRuntimeConfigSchema.partial()).max(10).optional(),
  })
  .passthrough();

export type SeasonProviderRuntimeConfig = z.infer<typeof seasonProviderRuntimeConfigSchema>;
export type ConfiguredProviderType = z.infer<typeof configuredProviderTypeSchema>;

export interface SeasonRuntimeConfig {
  providers: SeasonProviderRuntimeConfig[];
  standingsRule: 'LEGACY' | 'CBF_SERIE_A_2026';
}

/**
 * Data-migration helper only. Runtime provider selection never calls this
 * function; Prompt 1 metadata remains untouched as historical evidence.
 */
export function parseLegacySeasonProviderMetadataForMigration(
  metadata: Prisma.JsonValue | null,
): SeasonProviderRuntimeConfig[] {
  const parsed = legacySeasonRuntimeMetadataSchema.safeParse(metadata);
  if (!parsed.success) return [];
  return (parsed.data.providers ?? []).flatMap((provider) => {
    const result = seasonProviderRuntimeConfigSchema.safeParse(provider);
    return result.success ? [result.data] : [];
  });
}

function standingsRuleFromMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return 'LEGACY' as const;
  return metadata.tieBreakRule === 'cbf-rec-2026-art-15-v1'
    ? ('CBF_SERIE_A_2026' as const)
    : ('LEGACY' as const);
}

function runtimeProvider(config: {
  providerKey: string;
  priority: number;
  enabledTypes: ProviderSyncType[];
  active: boolean;
  cadenceSeconds: number;
  timeoutMs: number;
  includeProfiles: boolean;
  source: string;
  provenance: string;
  settings: Prisma.JsonValue | null;
}) {
  return seasonProviderRuntimeConfigSchema.parse({
    key: config.providerKey,
    priority: config.priority,
    types: config.enabledTypes,
    enabled: config.active,
    cadenceSeconds: config.cadenceSeconds,
    timeoutMs: config.timeoutMs,
    includeProfiles: config.includeProfiles,
    source: config.source,
    provenance: config.provenance,
    settings:
      config.settings && typeof config.settings === 'object' && !Array.isArray(config.settings)
        ? config.settings
        : {},
  });
}

const providerConfigSelect = {
  providerKey: true,
  priority: true,
  enabledTypes: true,
  active: true,
  cadenceSeconds: true,
  timeoutMs: true,
  includeProfiles: true,
  source: true,
  provenance: true,
  settings: true,
} satisfies Prisma.SeasonProviderConfigSelect;

export async function getSeasonRuntimeConfig(seasonId: string) {
  const season = await prisma.competitionSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true,
      status: true,
      metadata: true,
      providerConfigs: {
        where: { active: true },
        orderBy: [{ priority: 'asc' }, { providerKey: 'asc' }],
        select: providerConfigSelect,
      },
    },
  });
  if (!season) throw new AppError(404, 'Temporada nao encontrada.', 'SEASON_NOT_FOUND');
  return {
    seasonId: season.id,
    status: season.status,
    providers: season.providerConfigs.map(runtimeProvider),
    standingsRule: standingsRuleFromMetadata(season.metadata),
  };
}

export async function listActiveSeasonRuntimeConfigs() {
  const seasons = await prisma.competitionSeason.findMany({
    where: { status: 'ACTIVE', providerConfigs: { some: { active: true } } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      status: true,
      metadata: true,
      providerConfigs: {
        where: { active: true },
        orderBy: [{ priority: 'asc' }, { providerKey: 'asc' }],
        select: providerConfigSelect,
      },
    },
  });
  return seasons.map((season) => ({
    seasonId: season.id,
    status: season.status,
    providers: season.providerConfigs.map(runtimeProvider),
    standingsRule: standingsRuleFromMetadata(season.metadata),
  }));
}

export async function assertConfiguredProvider(
  seasonId: string,
  providerKey: string,
  type: ConfiguredProviderType,
) {
  const runtime = await getSeasonRuntimeConfig(seasonId);
  const config =
    runtime.providers.find(
      (provider) => provider.key === providerKey && provider.types.includes(type),
    ) ??
    (['csv', 'manual'].includes(providerKey)
      ? runtime.providers.find(
          (provider) =>
            provider.types.includes(type) &&
            Array.isArray(provider.settings.fallbackProviders) &&
            provider.settings.fallbackProviders.includes(providerKey),
        )
      : undefined);
  if (!config) {
    throw new AppError(
      400,
      'A temporada nao configurou este provider para o tipo solicitado.',
      'SEASON_PROVIDER_NOT_CONFIGURED',
    );
  }
  return config;
}

export async function upsertSeasonProviderConfig(input: {
  seasonId: string;
  config: SeasonProviderRuntimeConfig;
  actorId?: string | null;
  requestId?: string | null;
  justification: string;
}) {
  const config = seasonProviderRuntimeConfigSchema.parse(input.config);
  const previous = await prisma.seasonProviderConfig.findUnique({
    where: { seasonId_providerKey: { seasonId: input.seasonId, providerKey: config.key } },
  });
  return prisma.$transaction(async (tx) => {
    const saved = await tx.seasonProviderConfig.upsert({
      where: { seasonId_providerKey: { seasonId: input.seasonId, providerKey: config.key } },
      create: {
        seasonId: input.seasonId,
        providerKey: config.key,
        priority: config.priority,
        enabledTypes: config.types,
        cadenceSeconds: config.cadenceSeconds,
        timeoutMs: config.timeoutMs,
        active: config.enabled,
        includeProfiles: config.includeProfiles,
        source: config.source,
        provenance: config.provenance,
        settings: config.settings as Prisma.InputJsonValue,
      },
      update: {
        priority: config.priority,
        enabledTypes: config.types,
        cadenceSeconds: config.cadenceSeconds,
        timeoutMs: config.timeoutMs,
        active: config.enabled,
        includeProfiles: config.includeProfiles,
        source: config.source,
        provenance: config.provenance,
        settings: config.settings as Prisma.InputJsonValue,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: 'SEASON_PROVIDER_CONFIG_CHANGED',
        targetId: saved.id,
        requestId: input.requestId ?? null,
        seasonId: input.seasonId,
        justification: input.justification,
        before: previous
          ? (JSON.parse(JSON.stringify(previous)) as Prisma.InputJsonValue)
          : undefined,
        after: JSON.parse(JSON.stringify(saved)) as Prisma.InputJsonValue,
      },
    });
    return saved;
  });
}
