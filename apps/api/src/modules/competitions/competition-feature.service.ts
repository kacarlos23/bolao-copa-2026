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
    reason: z.string().trim().min(10).max(500),
    updatedAt: z.string().datetime(),
    updatedById: z.string().nullable(),
  })
  .strict();

export type CompetitionFeatureFlags = z.infer<typeof competitionFeatureFlagsSchema>;
export type CompetitionFeature = 'read' | 'write' | 'ui';

const defaults: CompetitionFeatureFlags = {
  readEnabled: true,
  writeEnabled: true,
  uiEnabled: true,
  reason: 'Temporada legada sem gate de exposição.',
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
};

function featureKey(seasonId: string) {
  return `competition-features:${seasonId}`;
}

export async function getCompetitionFeatureFlags(seasonId: string) {
  const setting = await prisma.appSetting.findUnique({ where: { key: featureKey(seasonId) } });
  return setting ? competitionFeatureFlagsSchema.parse(setting.value) : defaults;
}

export async function assertCompetitionFeature(
  seasonId: string,
  feature: CompetitionFeature,
  role: 'USER' | 'ADMIN',
) {
  if (role === 'ADMIN' || seasonId === WORLD_CUP_CONTEXT.seasonId) return;
  const flags = await getCompetitionFeatureFlags(seasonId);
  const enabled =
    feature === 'read'
      ? flags.readEnabled
      : feature === 'write'
        ? flags.writeEnabled
        : flags.uiEnabled;
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
