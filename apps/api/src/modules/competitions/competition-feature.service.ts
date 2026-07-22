import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import { WORLD_CUP_CONTEXT } from '../../domain/world-cup-context.js';

export const competitionFeatureFlagsSchema = z
  .object({
    readEnabled: z.boolean(),
    writeEnabled: z.boolean(),
    uiEnabled: z.boolean(),
    // Persisted records from before Prompt 4 retain scheduler compatibility.
    // New seasons must always store this field explicitly and start disabled.
    syncEnabled: z.boolean().default(true),
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

function featureKey(seasonId: string) {
  return `competition-features:${seasonId}`;
}

export async function getCompetitionFeatureFlags(seasonId: string) {
  const setting = await prisma.appSetting.findUnique({ where: { key: featureKey(seasonId) } });
  return setting
    ? competitionFeatureFlagsSchema.parse(setting.value)
    : COMPETITION_FEATURES_FAIL_CLOSED_DEFAULTS;
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

export async function updateCompetitionFeatureFlags(input: {
  seasonId: string;
  actorId: string;
  readEnabled: boolean;
  writeEnabled: boolean;
  uiEnabled: boolean;
  syncEnabled: boolean;
  reason: string;
}) {
  const season = await prisma.competitionSeason.findUnique({
    where: { id: input.seasonId },
    select: { id: true },
  });
  if (!season) throw new AppError(404, 'Temporada não encontrada.', 'SEASON_NOT_FOUND');
  const previous = await getCompetitionFeatureFlags(input.seasonId);
  const value: CompetitionFeatureFlags = {
    readEnabled: input.readEnabled,
    writeEnabled: input.writeEnabled,
    uiEnabled: input.uiEnabled,
    syncEnabled: input.syncEnabled,
    reason: input.reason,
    updatedAt: new Date().toISOString(),
    updatedById: input.actorId,
  };
  const result = await prisma.$transaction(async (tx) => {
    await tx.appSetting.upsert({
      where: { key: featureKey(input.seasonId) },
      create: { key: featureKey(input.seasonId), value },
      update: { value },
    });
    await tx.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        action: 'SETTING_UPDATED',
        targetId: input.seasonId,
        details: { setting: 'competition-features', previous, next: value },
      },
    });
    return enqueueOutboxEvent(tx, {
      type: 'competition.features.updated',
      seasonId: input.seasonId,
      poolSeasonId: null,
      payload: value,
    });
  });
  await dispatchOutboxEvent(result.id);
  return { previous, flags: value };
}
