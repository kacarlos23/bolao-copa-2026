import { z } from 'zod';
import type { CompetitionSeasonStatus, Prisma } from '@prisma/client';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { AppError } from '../../http/errors.js';
import { WORLD_CUP_CONTEXT } from '../../domain/world-cup-context.js';

export const competitionFeatureFlagsSchema = z
  .object({
    readEnabled: z.boolean(),
    writeEnabled: z.boolean(),
    uiEnabled: z.boolean(),
    syncEnabled: z.boolean(),
    reason: z.string().trim().min(10).max(500),
    updatedAt: z.string().datetime(),
    updatedById: z.string().nullable(),
  })
  .strict();

export type CompetitionFeatureFlags = z.infer<typeof competitionFeatureFlagsSchema>;
export type CompetitionFeature = 'read' | 'write' | 'ui' | 'sync';

export const COMPETITION_FEATURES_FAIL_CLOSED_DEFAULTS: CompetitionFeatureFlags = {
  readEnabled: false,
  writeEnabled: false,
  uiEnabled: false,
  syncEnabled: false,
  reason: 'Registro de feature flags ausente; exposição bloqueada por segurança.',
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
};

const restoredDraftFeatureFlagsSchema = competitionFeatureFlagsSchema
  .omit({ syncEnabled: true })
  .strict()
  .refine(
    (flags) => flags.readEnabled && flags.writeEnabled && flags.uiEnabled,
    'O estado restaurado exige read/write/ui habilitados.',
  );

export function competitionFeatureKey(seasonId: string) {
  return `competition-features:${seasonId}`;
}

export function inspectCompetitionFeatureFlagsValue(
  seasonId: string,
  value: Prisma.JsonValue | null | undefined,
  status?: CompetitionSeasonStatus | null,
) {
  if (value == null) {
    logger.warn({ seasonId, state: 'MISSING' }, 'competition feature flags failed closed');
    return {
      state: 'MISSING' as const,
      flags: { ...COMPETITION_FEATURES_FAIL_CLOSED_DEFAULTS },
    };
  }
  const parsed = competitionFeatureFlagsSchema.safeParse(value);
  if (!parsed.success) {
    const restored =
      status === 'DRAFT' ? restoredDraftFeatureFlagsSchema.safeParse(value) : null;
    if (restored?.success) {
      logger.warn(
        { seasonId, state: 'RESTORED_DRAFT' },
        'legacy restored competition feature flags preserved without persistence',
      );
      return {
        state: 'RESTORED_DRAFT' as const,
        flags: {
          ...restored.data,
          syncEnabled: false,
        },
      };
    }
    logger.warn({ seasonId, state: 'INVALID' }, 'competition feature flags failed closed');
    return {
      state: 'INVALID' as const,
      flags: {
        ...COMPETITION_FEATURES_FAIL_CLOSED_DEFAULTS,
        reason: 'Registro de feature flags inválido; exposição bloqueada por segurança.',
      },
    };
  }
  return { state: 'VALID' as const, flags: parsed.data };
}

export async function inspectCompetitionFeatureFlags(
  seasonId: string,
  knownStatus?: CompetitionSeasonStatus,
) {
  const [setting, status] = await Promise.all([
    prisma.appSetting.findUnique({
      where: { key: competitionFeatureKey(seasonId) },
    }),
    knownStatus
      ? knownStatus
      : prisma.competitionSeason
          .findUnique({ where: { id: seasonId }, select: { status: true } })
          .then((season) => season?.status ?? null),
  ]);
  return inspectCompetitionFeatureFlagsValue(seasonId, setting?.value, status);
}

export async function getCompetitionFeatureFlags(seasonId: string) {
  return (await inspectCompetitionFeatureFlags(seasonId)).flags;
}

export function buildCompetitionFeatureFlags(input: {
  actorId: string;
  readEnabled: boolean;
  writeEnabled: boolean;
  uiEnabled: boolean;
  syncEnabled: boolean;
  reason: string;
}) {
  return competitionFeatureFlagsSchema.parse({
    readEnabled: input.readEnabled,
    writeEnabled: input.writeEnabled,
    uiEnabled: input.uiEnabled,
    syncEnabled: input.syncEnabled,
    reason: input.reason,
    updatedAt: new Date().toISOString(),
    updatedById: input.actorId,
  });
}

export async function assertCompetitionFeature(
  seasonId: string,
  feature: CompetitionFeature,
  role: 'USER' | 'ADMIN',
) {
  if (role === 'ADMIN' || seasonId === WORLD_CUP_CONTEXT.seasonId) return;
  const flags = await getCompetitionFeatureFlags(seasonId);
  const enabled = {
    read: flags.readEnabled,
    write: flags.writeEnabled,
    ui: flags.uiEnabled,
    sync: flags.syncEnabled,
  }[feature];
  if (!enabled) {
    throw new AppError(
      404,
      'Temporada indisponível durante o canário administrativo.',
      'COMPETITION_FEATURE_DISABLED',
    );
  }
}
