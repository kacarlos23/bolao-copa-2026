import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';

export const configuredProviderTypeSchema = z.enum([
  'TEAMS',
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
    timeoutMs: z.number().int().min(1_000).max(180_000).default(10_000),
    includeProfiles: z.boolean().default(false),
  })
  .strict();

const seasonRuntimeMetadataSchema = z
  .object({
    providers: z.array(seasonProviderRuntimeConfigSchema).max(10).optional(),
    tieBreakRule: z.string().trim().min(1).max(120).optional(),
  })
  .passthrough();

const legacyOfficialSourceMetadataSchema = z
  .object({
    source: z
      .object({
        source: z.string().url(),
        timezone: z.literal('America/Sao_Paulo'),
        roundsFetched: z.number().int().positive(),
        standings: z.number().int().positive(),
      })
      .passthrough(),
    tieBreakRule: z.literal('cbf-rec-2026-art-15-v1'),
  })
  .passthrough();

export type SeasonProviderRuntimeConfig = z.infer<typeof seasonProviderRuntimeConfigSchema>;
export type ConfiguredProviderType = z.infer<typeof configuredProviderTypeSchema>;

export interface SeasonRuntimeConfig {
  providers: SeasonProviderRuntimeConfig[];
  standingsRule: 'LEGACY' | 'CBF_SERIE_A_2026';
}

/**
 * Transitional reader for Prompt 1. Prompt 3 will move this validated shape to
 * SeasonProviderConfig without changing its consumers.
 */
export function parseSeasonRuntimeConfig(metadata: Prisma.JsonValue | null): SeasonRuntimeConfig {
  const parsed = seasonRuntimeMetadataSchema.safeParse(metadata);
  if (!parsed.success) return { providers: [], standingsRule: 'LEGACY' };

  let providers = parsed.data.providers ?? [];
  if (!providers.length) {
    const legacy = legacyOfficialSourceMetadataSchema.safeParse(metadata);
    if (legacy.success) {
      providers = [
        seasonProviderRuntimeConfigSchema.parse({
          key: 'cbf-official',
          priority: 1,
          types: ['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS'],
          enabled: true,
          timeoutMs: 10_000,
          includeProfiles: true,
        }),
      ];
    }
  }

  const uniqueKeys = new Set<string>();
  const enabledProviders = providers
    .filter((provider) => provider.enabled)
    .sort((left, right) => left.priority - right.priority)
    .filter((provider) => {
      if (uniqueKeys.has(provider.key)) return false;
      uniqueKeys.add(provider.key);
      return true;
    });
  return {
    providers: enabledProviders,
    standingsRule:
      parsed.data.tieBreakRule === 'cbf-rec-2026-art-15-v1'
        ? 'CBF_SERIE_A_2026'
        : 'LEGACY',
  };
}

export async function getSeasonRuntimeConfig(seasonId: string) {
  const season = await prisma.competitionSeason.findUnique({
    where: { id: seasonId },
    select: { id: true, status: true, metadata: true },
  });
  if (!season) throw new AppError(404, 'Temporada nao encontrada.', 'SEASON_NOT_FOUND');
  return { seasonId: season.id, status: season.status, ...parseSeasonRuntimeConfig(season.metadata) };
}

export async function listActiveSeasonRuntimeConfigs() {
  const seasons = await prisma.competitionSeason.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true, status: true, metadata: true },
  });
  return seasons
    .map((season) => ({
      seasonId: season.id,
      status: season.status,
      ...parseSeasonRuntimeConfig(season.metadata),
    }))
    .filter((season) => season.providers.length > 0);
}
