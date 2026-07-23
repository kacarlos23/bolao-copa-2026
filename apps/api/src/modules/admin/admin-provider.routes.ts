import { Router } from 'express';
import { MatchStatus, ProviderEntityType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler.js';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import { recalculateScoresForMatch } from '../../services/ranking.service.js';
import { recomputeTie } from '../ties/tie-recomputation.service.js';
import { manualMatchOverrideSchema } from '../providers/manual-override.service.js';
import { providerOperationalCadenceSchema } from '../providers/provider-cadence.js';
import { syncOfficialSeasonCompetitionData } from '../providers/season-result-sync.service.js';
import { getCompetitionFeatureFlags } from '../competitions/competition-feature.service.js';
import {
  adminRequestContext,
  createAdminPreview,
  executeSensitiveMutation,
  justificationSchema,
  reinforcedConfirmationSchema,
  setAdminScope,
} from './admin-security.js';

export const adminProviderRouter = Router();

const providerCadenceMutationSchema = z
  .object({
    cadenceSeconds: z.number().int().min(5).max(86_400),
    operationalCadence: providerOperationalCadenceSchema,
    justification: justificationSchema,
  })
  .strict();

async function providerCadencePlan(
  database: Pick<Prisma.TransactionClient, 'seasonProviderConfig' | 'stage' | 'round'>,
  seasonId: string,
  providerKey: string,
  body: z.infer<typeof providerCadenceMutationSchema>,
) {
  const config = await database.seasonProviderConfig.findUnique({
    where: { seasonId_providerKey: { seasonId, providerKey } },
  });
  if (!config) {
    throw new AppError(
      404,
      'Provider não configurado para a temporada.',
      'SEASON_PROVIDER_NOT_CONFIGURED',
    );
  }
  for (const phase of body.operationalCadence.phases) {
    const [stage, round] = await Promise.all([
      phase.stageId
        ? database.stage.findFirst({ where: { id: phase.stageId, seasonId } })
        : null,
      phase.roundId
        ? database.round.findFirst({ where: { id: phase.roundId, seasonId } })
        : null,
    ]);
    if ((phase.stageId && !stage) || (phase.roundId && !round)) {
      throw new AppError(
        400,
        'A fase configurada não pertence à temporada.',
        'PROVIDER_CADENCE_SCOPE_MISMATCH',
      );
    }
    if (stage && round && round.stageId !== stage.id) {
      throw new AppError(
        400,
        'A rodada configurada não pertence à fase informada.',
        'PROVIDER_CADENCE_SCOPE_MISMATCH',
      );
    }
  }
  const settings =
    config.settings && typeof config.settings === 'object' && !Array.isArray(config.settings)
      ? config.settings
      : {};
  const previousCadence = providerOperationalCadenceSchema.safeParse(
    settings.operationalCadence,
  );
  return {
    config,
    previousOperationalCadence: previousCadence.success ? previousCadence.data : null,
    next: {
      cadenceSeconds: body.cadenceSeconds,
      settings: {
        ...settings,
        operationalCadence: body.operationalCadence,
      } as Prisma.InputJsonValue,
    },
  };
}

adminProviderRouter.post(
  '/seasons/:seasonId/providers/:providerKey/cadence/preview',
  asyncHandler(async (req, res) => {
    const body = providerCadenceMutationSchema.parse(req.body);
    setAdminScope(req, { seasonId: req.params.seasonId });
    const plan = await providerCadencePlan(
      prisma,
      req.params.seasonId,
      req.params.providerKey,
      body,
    );
    res.json(
      await createAdminPreview({
        context: adminRequestContext(req),
        action: 'SEASON_PROVIDER_CADENCE_CHANGE',
        scope: {
          targetType: 'SeasonProviderConfig',
          targetId: plan.config.id,
          seasonId: req.params.seasonId,
        },
        justification: body.justification,
        request: {
          cadenceSeconds: body.cadenceSeconds,
          operationalCadence: body.operationalCadence,
        },
        preview: {
          before: {
            cadenceSeconds: plan.config.cadenceSeconds,
            operationalCadence: plan.previousOperationalCadence,
          },
          after: {
            cadenceSeconds: plan.next.cadenceSeconds,
            operationalCadence: body.operationalCadence,
          },
          rollback: 'Reaplique a cadência anterior pelo mesmo fluxo auditado.',
        },
        affectedCount: 1,
      }),
    );
  }),
);

adminProviderRouter.put(
  '/seasons/:seasonId/providers/:providerKey/cadence',
  asyncHandler(async (req, res) => {
    const body = providerCadenceMutationSchema
      .extend(reinforcedConfirmationSchema.shape)
      .strict()
      .parse(req.body);
    setAdminScope(req, { seasonId: req.params.seasonId });
    const current = await prisma.seasonProviderConfig.findUnique({
      where: {
        seasonId_providerKey: {
          seasonId: req.params.seasonId,
          providerKey: req.params.providerKey,
        },
      },
      select: { id: true },
    });
    if (!current) {
      throw new AppError(
        404,
        'Provider não configurado para a temporada.',
        'SEASON_PROVIDER_NOT_CONFIGURED',
      );
    }
    const requestBody = {
      cadenceSeconds: body.cadenceSeconds,
      operationalCadence: body.operationalCadence,
    };
    const response = await executeSensitiveMutation({
      context: adminRequestContext(req),
      action: 'SEASON_PROVIDER_CONFIG_CHANGED',
      operation: 'SEASON_PROVIDER_CADENCE_CHANGE',
      scope: {
        targetType: 'SeasonProviderConfig',
        targetId: current.id,
        seasonId: req.params.seasonId,
      },
      justification: body.justification,
      request: requestBody,
      confirmation: body,
      mutate: async (tx) => {
        const plan = await providerCadencePlan(
          tx,
          req.params.seasonId,
          req.params.providerKey,
          body,
        );
        const after = await tx.seasonProviderConfig.update({
          where: { id: plan.config.id },
          data: plan.next,
        });
        return {
          before: {
            id: plan.config.id,
            seasonId: plan.config.seasonId,
            providerKey: plan.config.providerKey,
            cadenceSeconds: plan.config.cadenceSeconds,
            operationalCadence: plan.previousOperationalCadence,
          },
          after: {
            id: after.id,
            seasonId: after.seasonId,
            providerKey: after.providerKey,
            cadenceSeconds: after.cadenceSeconds,
            operationalCadence: body.operationalCadence,
          },
          result: {
            id: after.id,
            seasonId: after.seasonId,
            providerKey: after.providerKey,
            cadenceSeconds: after.cadenceSeconds,
            operationalCadence: body.operationalCadence,
          },
          affectedCount: 1,
        };
      },
    });
    res.json(response);
  }),
);

const competitionDataRefreshSchema = z
  .object({
    includeProfiles: z.boolean().default(true),
    justification: justificationSchema,
  })
  .strict();

adminProviderRouter.post(
  '/seasons/:seasonId/refresh-competition-data',
  asyncHandler(async (req, res) => {
    const body = competitionDataRefreshSchema.parse(req.body);
    const context = adminRequestContext(req);
    setAdminScope(req, { seasonId: req.params.seasonId });
    const featureFlagsBefore = await getCompetitionFeatureFlags(req.params.seasonId);
    const result = await syncOfficialSeasonCompetitionData({
      seasonId: req.params.seasonId,
      userId: req.session.user!.id,
      idempotencyKey: context.idempotencyKey,
      includeProfiles: body.includeProfiles,
    });
    const featureFlags = await getCompetitionFeatureFlags(req.params.seasonId);
    const featureFlagsUnchanged =
      JSON.stringify(featureFlagsBefore) === JSON.stringify(featureFlags);
    const response = { ...result, featureFlags, featureFlagsUnchanged };
    await prisma.adminAuditLog.create({
      data: {
        actorId: context.actorId,
        action: 'SYNC_REQUESTED',
        targetId: req.params.seasonId,
        requestId: context.requestId,
        seasonId: req.params.seasonId,
        poolSeasonId: null,
        justification: body.justification,
        idempotencyKey: `audit:${context.idempotencyKey}`,
        origin: context.origin,
        before: { featureFlags: featureFlagsBefore },
        after: JSON.parse(JSON.stringify(response)),
        details: {
          affectedCount:
            result.runs.reduce(
              (total, run) =>
                total + run.counts.inserted + run.counts.updated + run.counts.quarantined,
              0,
            ) + result.updatedProfiles,
        },
      },
    });
    res.json(response);
  }),
);

const liveResultSchema = z
  .object({
    status: z.enum(['LIVE', 'FINISHED']),
    homeScore: z.number().int().min(0).max(99),
    awayScore: z.number().int().min(0).max(99),
    justification: justificationSchema,
  })
  .strict();

adminProviderRouter.put(
  '/seasons/:seasonId/matches/:matchId/live-result',
  asyncHandler(async (req, res) => {
    const body = liveResultSchema.parse(req.body);
    const context = adminRequestContext(req);
    setAdminScope(req, { seasonId: req.params.seasonId });
    let eventId: string | undefined;
    const values = {
      status: body.status,
      homeScore: body.homeScore,
      awayScore: body.awayScore,
      finalHomeScore: body.status === 'FINISHED' ? body.homeScore : null,
      finalAwayScore: body.status === 'FINISHED' ? body.awayScore : null,
    };
    const response = await executeSensitiveMutation({
      context,
      action: 'MATCH_ADJUSTED',
      operation: 'MATCH_LIVE_RESULT_SET',
      scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId },
      justification: body.justification,
      request: values,
      mutate: async (tx) => {
        const match = await tx.match.findFirst({
          where: { id: req.params.matchId, seasonId: req.params.seasonId },
        });
        if (!match)
          throw new AppError(404, 'Partida nao encontrada na temporada.', 'MATCH_NOT_FOUND');
        const before = {
          startsAt: match.startsAt.toISOString(),
          status: match.status,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          finalHomeScore: match.finalHomeScore,
          finalAwayScore: match.finalAwayScore,
        };
        const saved = await tx.match.update({
          where: { id: match.id },
          data: {
            status: values.status as MatchStatus,
            homeScore: values.homeScore,
            awayScore: values.awayScore,
            finalHomeScore: values.finalHomeScore,
            finalAwayScore: values.finalAwayScore,
            ...(match.tieId
              ? {
                  regulationHomeScore: values.homeScore,
                  regulationAwayScore: values.awayScore,
                }
              : {}),
            rawPayload: {
              ...objectPayload(match.rawPayload),
              manualLiveResult: {
                source: 'ADMIN_PANEL',
                actorId: req.session.user!.id,
                appliedAt: new Date().toISOString(),
              },
            },
          },
        });
        await tx.matchOverride.upsert({
          where: { matchId: match.id },
          create: {
            matchId: match.id,
            actorId: req.session.user!.id,
            justification: body.justification,
            values,
            before,
            active: true,
          },
          update: {
            actorId: req.session.user!.id,
            justification: body.justification,
            values,
            before,
            active: true,
            removedAt: null,
          },
        });
        const event = await enqueueOutboxEvent(tx, {
          type: 'match.updated',
          seasonId: req.params.seasonId,
          poolSeasonId: null,
          payload: { matchIds: [match.id], source: 'ADMIN_PANEL', status: values.status },
          idempotencyKey: `match.live-result:${context.idempotencyKey}`,
        });
        eventId = event.id;
        return {
          before,
          after: saved,
          result: saved,
          affectedCount: 1,
          details: { source: 'ADMIN_PANEL' },
        };
      },
    });
    if (eventId) await dispatchOutboxEvent(eventId);
    if (response.result.tieId) await recomputeTie(response.result.tieId);
    await recalculateScoresForMatch(req.params.matchId);
    res.json(response);
  }),
);

const mappingSchema = z
  .object({
    internalId: z.string().min(1).max(200),
    externalId: z.string().min(1).max(200).optional(),
    justification: justificationSchema,
  })
  .strict();

function objectPayload(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mappingEntityType(type: string, payload: Record<string, unknown>): ProviderEntityType {
  if (type === 'TEAMS' || type === 'STANDINGS') return 'TEAM';
  if (type === 'STRUCTURE') return payload.kind === 'STAGE' ? 'STAGE' : 'ROUND';
  if (type === 'TIES') return 'TIE';
  return 'MATCH';
}

function mappingScope(seasonId: string) {
  return `season:${seasonId}`;
}

function storedMappingExternalId(seasonId: string, externalId: string) {
  return `${mappingScope(seasonId)}:${externalId}`;
}

function mappingExternalId(
  entityType: ProviderEntityType,
  payload: Record<string, unknown>,
  fallback: string | null,
) {
  if (entityType === 'MATCH' && typeof payload.matchExternalId === 'string') {
    return payload.matchExternalId;
  }
  if (entityType === 'TEAM' && typeof payload.teamExternalId === 'string') {
    return payload.teamExternalId;
  }
  return fallback;
}

async function mappingPlan(quarantineId: string, body: z.infer<typeof mappingSchema>) {
  const item = await prisma.syncQuarantine.findFirst({
    where: { id: quarantineId, resolvedAt: null },
  });
  if (!item)
    throw new AppError(404, 'Divergência não encontrada ou já resolvida.', 'QUARANTINE_NOT_FOUND');
  const payload = objectPayload(item.payload);
  const entityType = mappingEntityType(item.type, payload);
  const externalId = body.externalId ?? mappingExternalId(entityType, payload, item.externalId);
  if (!externalId)
    throw new AppError(400, 'externalId é obrigatório.', 'MAPPING_EXTERNAL_ID_REQUIRED');
  const validTarget =
    entityType === 'TEAM'
      ? await prisma.seasonTeam.findUnique({
          where: { seasonId_teamId: { seasonId: item.seasonId, teamId: body.internalId } },
        })
      : entityType === 'STAGE'
        ? await prisma.stage.findFirst({ where: { id: body.internalId, seasonId: item.seasonId } })
        : entityType === 'ROUND'
          ? await prisma.round.findFirst({
              where: { id: body.internalId, seasonId: item.seasonId },
            })
          : entityType === 'TIE'
            ? await prisma.tie.findFirst({
                where: { id: body.internalId, seasonId: item.seasonId },
              })
            : await prisma.match.findFirst({
                where: { id: body.internalId, seasonId: item.seasonId },
              });
  if (!validTarget)
    throw new AppError(
      400,
      'O alvo não pertence à temporada da divergência.',
      'INVALID_MAPPING_TARGET',
    );
  const storedExternalId = storedMappingExternalId(item.seasonId, externalId);
  const current = await prisma.providerEntityMapping.findFirst({
    where: {
      provider: item.provider,
      entityType,
      OR: [
        { scopeKey: mappingScope(item.seasonId), externalId: storedExternalId },
        { seasonId: item.seasonId, externalId },
      ],
    },
  });
  return { item, entityType, externalId, storedExternalId, current };
}

adminProviderRouter.post(
  '/mappings/:quarantineId/resolve/preview',
  asyncHandler(async (req, res) => {
    const body = mappingSchema.parse(req.body);
    const plan = await mappingPlan(req.params.quarantineId, body);
    setAdminScope(req, { seasonId: plan.item.seasonId });
    res.json(
      await createAdminPreview({
        context: adminRequestContext(req),
        action: 'RESOLVE_PROVIDER_MAPPING',
        scope: {
          targetType: 'SyncQuarantine',
          targetId: plan.item.id,
          seasonId: plan.item.seasonId,
        },
        justification: body.justification,
        request: { internalId: body.internalId, externalId: body.externalId },
        preview: {
          quarantine: { id: plan.item.id, reason: plan.item.reason, message: plan.item.message },
          before: plan.current,
          after: {
            provider: plan.item.provider,
            scopeKey: mappingScope(plan.item.seasonId),
            entityType: plan.entityType,
            externalId: plan.storedExternalId,
            rawExternalId: plan.externalId,
            internalId: body.internalId,
            seasonId: plan.item.seasonId,
          },
        },
        affectedCount: plan.current ? 2 : 2,
      }),
    );
  }),
);

adminProviderRouter.put(
  '/mappings/:quarantineId/resolve',
  asyncHandler(async (req, res) => {
    const body = mappingSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body);
    const item = await prisma.syncQuarantine.findUnique({ where: { id: req.params.quarantineId } });
    if (!item) throw new AppError(404, 'Divergência não encontrada.', 'QUARANTINE_NOT_FOUND');
    setAdminScope(req, { seasonId: item.seasonId });
    const response = await executeSensitiveMutation({
      context: adminRequestContext(req),
      action: 'MAPPING_RESOLVED',
      operation: 'RESOLVE_PROVIDER_MAPPING',
      scope: { targetType: 'SyncQuarantine', targetId: item.id, seasonId: item.seasonId },
      justification: body.justification,
      request: { internalId: body.internalId, externalId: body.externalId },
      confirmation: body,
      mutate: async (tx) => {
        const pending = await tx.syncQuarantine.findFirst({
          where: { id: item.id, resolvedAt: null },
        });
        if (!pending)
          throw new AppError(409, 'Divergência já resolvida.', 'QUARANTINE_ALREADY_RESOLVED');
        const payload = objectPayload(pending.payload);
        const entityType = mappingEntityType(pending.type, payload);
        const externalId =
          body.externalId ?? mappingExternalId(entityType, payload, pending.externalId);
        if (!externalId)
          throw new AppError(400, 'externalId é obrigatório.', 'MAPPING_EXTERNAL_ID_REQUIRED');
        const validTarget =
          entityType === 'TEAM'
            ? await tx.seasonTeam.findUnique({
                where: { seasonId_teamId: { seasonId: pending.seasonId, teamId: body.internalId } },
              })
            : entityType === 'STAGE'
              ? await tx.stage.findFirst({
                  where: { id: body.internalId, seasonId: pending.seasonId },
                })
              : entityType === 'ROUND'
                ? await tx.round.findFirst({
                    where: { id: body.internalId, seasonId: pending.seasonId },
                  })
                : entityType === 'TIE'
                  ? await tx.tie.findFirst({
                      where: { id: body.internalId, seasonId: pending.seasonId },
                    })
                  : await tx.match.findFirst({
                      where: { id: body.internalId, seasonId: pending.seasonId },
                    });
        if (!validTarget)
          throw new AppError(400, 'Alvo de outra temporada.', 'INVALID_MAPPING_TARGET');
        const scopeKey = mappingScope(pending.seasonId);
        const storedExternalId = storedMappingExternalId(pending.seasonId, externalId);
        const before = await tx.providerEntityMapping.findFirst({
          where: {
            provider: pending.provider,
            entityType,
            OR: [
              { scopeKey, externalId: storedExternalId },
              { seasonId: pending.seasonId, externalId },
            ],
          },
        });
        const mappingValues = {
          internalId: body.internalId,
          seasonId: pending.seasonId,
          sourceUrl: 'reconciliation://manual',
          collectedAt: new Date(),
          metadata: {
            rawExternalId: externalId,
            provenance: 'ADMIN_MANUAL',
            justification: body.justification,
            actorId: req.session.user!.id,
          },
        };
        const mapping = before
          ? await tx.providerEntityMapping.update({
              where: { id: before.id },
              data: mappingValues,
            })
          : await tx.providerEntityMapping.create({
              data: {
                provider: pending.provider,
                scopeKey,
                entityType,
                externalId: storedExternalId,
                ...mappingValues,
              },
            });
        const resolved = await tx.syncQuarantine.update({
          where: { id: pending.id },
          data: { resolvedAt: new Date(), resolvedById: req.session.user!.id },
        });
        return {
          before: { mapping: before, quarantine: pending },
          after: { mapping, quarantine: resolved },
          result: { mapping, item: resolved },
          affectedCount: 2,
        };
      },
    });
    res.json(response);
  }),
);

const overridePreviewSchema = manualMatchOverrideSchema
  .extend({ dryRun: z.literal(true).optional() })
  .strict();
const overrideApplySchema = manualMatchOverrideSchema
  .extend({ dryRun: z.literal(false).optional(), ...reinforcedConfirmationSchema.shape })
  .strict();

async function matchOverridePlan(
  seasonId: string,
  matchId: string,
  input: z.infer<typeof manualMatchOverrideSchema>,
) {
  const match = await prisma.match.findFirst({
    where: { id: matchId, seasonId },
    include: { manualOverride: true, _count: { select: { predictions: true, scores: true } } },
  });
  if (!match) throw new AppError(404, 'Partida não encontrada na temporada.', 'MATCH_NOT_FOUND');
  const before = {
    startsAt: match.startsAt.toISOString(),
    status: match.status,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    finalHomeScore: match.finalHomeScore,
    finalAwayScore: match.finalAwayScore,
  };
  return {
    match,
    before,
    after: { ...before, ...input.values },
    affectedCount: 1 + match._count.predictions + match._count.scores,
  };
}

adminProviderRouter.post(
  '/seasons/:seasonId/matches/:matchId/override/preview',
  asyncHandler(async (req, res) => {
    const body = overridePreviewSchema.parse(req.body);
    const plan = await matchOverridePlan(req.params.seasonId, req.params.matchId, body);
    setAdminScope(req, { seasonId: req.params.seasonId });
    res.json(
      await createAdminPreview({
        context: adminRequestContext(req),
        action: 'MATCH_OVERRIDE_APPLY',
        scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId },
        justification: body.justification,
        request: { values: body.values },
        preview: {
          before: plan.before,
          after: plan.after,
          predictions: plan.match._count.predictions,
          scores: plan.match._count.scores,
          provenance: 'ADMIN_MANUAL',
        },
        affectedCount: plan.affectedCount,
      }),
    );
  }),
);

adminProviderRouter.put(
  '/seasons/:seasonId/matches/:matchId/override',
  asyncHandler(async (req, res) => {
    const body = overrideApplySchema.parse(req.body);
    setAdminScope(req, { seasonId: req.params.seasonId });
    let eventId: string | undefined;
    const response = await executeSensitiveMutation({
      context: adminRequestContext(req),
      action: 'MATCH_OVERRIDE_SET',
      operation: 'MATCH_OVERRIDE_APPLY',
      scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId },
      justification: body.justification,
      request: { values: body.values },
      confirmation: body,
      mutate: async (tx) => {
        const match = await tx.match.findFirst({
          where: { id: req.params.matchId, seasonId: req.params.seasonId },
        });
        if (!match)
          throw new AppError(404, 'Partida não encontrada na temporada.', 'MATCH_NOT_FOUND');
        const before = {
          startsAt: match.startsAt.toISOString(),
          status: match.status,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          finalHomeScore: match.finalHomeScore,
          finalAwayScore: match.finalAwayScore,
        };
        const saved = await tx.match.update({
          where: { id: match.id },
          data: {
            ...(body.values.startsAt ? { startsAt: new Date(body.values.startsAt) } : {}),
            ...(body.values.status ? { status: body.values.status as MatchStatus } : {}),
            ...(body.values.homeScore !== undefined ? { homeScore: body.values.homeScore } : {}),
            ...(body.values.awayScore !== undefined ? { awayScore: body.values.awayScore } : {}),
            ...(body.values.finalHomeScore !== undefined
              ? { finalHomeScore: body.values.finalHomeScore }
              : {}),
            ...(body.values.finalAwayScore !== undefined
              ? { finalAwayScore: body.values.finalAwayScore }
              : {}),
          },
        });
        await tx.matchOverride.upsert({
          where: { matchId: match.id },
          create: {
            matchId: match.id,
            actorId: req.session.user!.id,
            justification: body.justification,
            values: body.values,
            before,
            active: true,
          },
          update: {
            actorId: req.session.user!.id,
            justification: body.justification,
            values: body.values,
            before,
            active: true,
            removedAt: null,
          },
        });
        const event = await enqueueOutboxEvent(tx, {
          type: 'match.override.updated',
          seasonId: req.params.seasonId,
          poolSeasonId: null,
          payload: { matchId: match.id, active: true, provenance: 'ADMIN_MANUAL' },
          idempotencyKey: `match.override:${adminRequestContext(req).idempotencyKey}`,
        });
        eventId = event.id;
        return {
          before,
          after: saved,
          result: saved,
          affectedCount: 1,
          details: { provenance: 'ADMIN_MANUAL' },
        };
      },
    });
    if (eventId) await dispatchOutboxEvent(eventId);
    res.json(response);
  }),
);

const rollbackSchema = z.object({ justification: justificationSchema }).strict();
adminProviderRouter.post(
  '/seasons/:seasonId/matches/:matchId/override/rollback-preview',
  asyncHandler(async (req, res) => {
    const body = rollbackSchema.parse(req.body);
    const current = await prisma.matchOverride.findFirst({
      where: {
        matchId: req.params.matchId,
        active: true,
        match: { seasonId: req.params.seasonId },
      },
    });
    if (!current)
      throw new AppError(404, 'Override ativo não encontrado.', 'MATCH_OVERRIDE_NOT_FOUND');
    setAdminScope(req, { seasonId: req.params.seasonId });
    res.json(
      await createAdminPreview({
        context: adminRequestContext(req),
        action: 'MATCH_OVERRIDE_ROLLBACK',
        scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId },
        justification: body.justification,
        request: {},
        preview: {
          overriddenValues: current.values,
          restore: current.before,
          note: 'A precedência manual será removida e o before será restaurado.',
        },
        affectedCount: 1,
      }),
    );
  }),
);

adminProviderRouter.post(
  '/seasons/:seasonId/matches/:matchId/override/rollback',
  asyncHandler(async (req, res) => {
    const body = rollbackSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body);
    setAdminScope(req, { seasonId: req.params.seasonId });
    const response = await executeSensitiveMutation({
      context: adminRequestContext(req),
      action: 'MATCH_OVERRIDE_REMOVED',
      operation: 'MATCH_OVERRIDE_ROLLBACK',
      scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId },
      justification: body.justification,
      request: {},
      confirmation: body,
      mutate: async (tx) => {
        const override = await tx.matchOverride.findFirst({
          where: {
            matchId: req.params.matchId,
            active: true,
            match: { seasonId: req.params.seasonId },
          },
        });
        if (!override)
          throw new AppError(404, 'Override ativo não encontrado.', 'MATCH_OVERRIDE_NOT_FOUND');
        const restore = objectPayload(override.before);
        const match = await tx.match.findFirstOrThrow({
          where: { id: req.params.matchId, seasonId: req.params.seasonId },
        });
        const restored = await tx.match.update({
          where: { id: match.id },
          data: {
            ...(typeof restore.startsAt === 'string'
              ? { startsAt: new Date(restore.startsAt) }
              : {}),
            ...(typeof restore.status === 'string'
              ? { status: restore.status as MatchStatus }
              : {}),
            ...(Object.hasOwn(restore, 'homeScore')
              ? { homeScore: restore.homeScore as number | null }
              : {}),
            ...(Object.hasOwn(restore, 'awayScore')
              ? { awayScore: restore.awayScore as number | null }
              : {}),
            ...(Object.hasOwn(restore, 'finalHomeScore')
              ? { finalHomeScore: restore.finalHomeScore as number | null }
              : {}),
            ...(Object.hasOwn(restore, 'finalAwayScore')
              ? { finalAwayScore: restore.finalAwayScore as number | null }
              : {}),
          },
        });
        await tx.matchOverride.update({
          where: { id: override.id },
          data: { active: false, removedAt: new Date() },
        });
        return {
          before: match,
          after: restored,
          result: restored,
          affectedCount: 1,
          details: { overrideId: override.id },
        };
      },
    });
    res.json(response);
  }),
);
