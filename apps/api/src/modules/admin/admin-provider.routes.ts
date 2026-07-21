import { Router } from 'express';
import { MatchStatus, ProviderEntityType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler.js';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import { recalculateScoresForMatch } from '../../services/ranking.service.js';
import { manualMatchOverrideSchema } from '../providers/manual-override.service.js';
import { syncOfficialSeasonCompetitionData } from '../providers/season-result-sync.service.js';
import {
  adminRequestContext, createAdminPreview, executeSensitiveMutation, justificationSchema,
  reinforcedConfirmationSchema, setAdminScope,
} from './admin-security.js';

export const adminProviderRouter = Router();

const competitionDataRefreshSchema = z.object({
  includeProfiles: z.boolean().default(true),
  justification: justificationSchema,
}).strict();

adminProviderRouter.post('/seasons/:seasonId/refresh-competition-data', asyncHandler(async (req, res) => {
  const body = competitionDataRefreshSchema.parse(req.body);
  const context = adminRequestContext(req);
  setAdminScope(req, { seasonId: req.params.seasonId });
  const result = await syncOfficialSeasonCompetitionData({
    seasonId: req.params.seasonId,
    userId: req.session.user!.id,
    idempotencyKey: context.idempotencyKey,
    includeProfiles: body.includeProfiles,
  });
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
      before: {},
      after: JSON.parse(JSON.stringify(result)),
      details: {
        affectedCount: result.runs.reduce((total, run) => total + run.counts.inserted + run.counts.updated + run.counts.quarantined, 0) + result.updatedProfiles,
      },
    },
  });
  res.json(result);
}));

const liveResultSchema = z.object({
  status: z.enum(['LIVE', 'FINISHED']),
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
  justification: justificationSchema,
}).strict();

adminProviderRouter.put('/seasons/:seasonId/matches/:matchId/live-result', asyncHandler(async (req, res) => {
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
      if (!match) throw new AppError(404, 'Partida nao encontrada na temporada.', 'MATCH_NOT_FOUND');
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
      return { before, after: saved, result: saved, affectedCount: 1, details: { source: 'ADMIN_PANEL' } };
    },
  });
  if (eventId) await dispatchOutboxEvent(eventId);
  await recalculateScoresForMatch(req.params.matchId);
  res.json(response);
}));

const mappingSchema = z.object({
  internalId: z.string().min(1).max(200), externalId: z.string().min(1).max(200).optional(),
  justification: justificationSchema,
}).strict();

function objectPayload(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function mappingPlan(quarantineId: string, body: z.infer<typeof mappingSchema>) {
  const item = await prisma.syncQuarantine.findFirst({ where: { id: quarantineId, resolvedAt: null } });
  if (!item) throw new AppError(404, 'Divergência não encontrada ou já resolvida.', 'QUARANTINE_NOT_FOUND');
  const payload = objectPayload(item.payload);
  const entityType: ProviderEntityType = item.type === 'TEAMS' || item.type === 'STANDINGS' ? 'TEAM' : 'MATCH';
  const externalId = body.externalId ?? (entityType === 'MATCH' && typeof payload.matchExternalId === 'string' ? payload.matchExternalId : entityType === 'TEAM' && typeof payload.teamExternalId === 'string' ? payload.teamExternalId : item.externalId);
  if (!externalId) throw new AppError(400, 'externalId é obrigatório.', 'MAPPING_EXTERNAL_ID_REQUIRED');
  const validTarget = entityType === 'TEAM'
    ? await prisma.seasonTeam.findUnique({ where: { seasonId_teamId: { seasonId: item.seasonId, teamId: body.internalId } } })
    : await prisma.match.findFirst({ where: { id: body.internalId, seasonId: item.seasonId } });
  if (!validTarget) throw new AppError(400, 'O alvo não pertence à temporada da divergência.', 'INVALID_MAPPING_TARGET');
  const current = await prisma.providerEntityMapping.findUnique({ where: { provider_entityType_externalId: { provider: item.provider, entityType, externalId } } });
  return { item, entityType, externalId, current };
}

adminProviderRouter.post('/mappings/:quarantineId/resolve/preview', asyncHandler(async (req, res) => {
  const body = mappingSchema.parse(req.body); const plan = await mappingPlan(req.params.quarantineId, body);
  setAdminScope(req, { seasonId: plan.item.seasonId });
  res.json(await createAdminPreview({
    context: adminRequestContext(req), action: 'RESOLVE_PROVIDER_MAPPING',
    scope: { targetType: 'SyncQuarantine', targetId: plan.item.id, seasonId: plan.item.seasonId },
    justification: body.justification, request: { internalId: body.internalId, externalId: body.externalId },
    preview: { quarantine: { id: plan.item.id, reason: plan.item.reason, message: plan.item.message }, before: plan.current, after: { provider: plan.item.provider, entityType: plan.entityType, externalId: plan.externalId, internalId: body.internalId, seasonId: plan.item.seasonId } },
    affectedCount: plan.current ? 2 : 2,
  }));
}));

adminProviderRouter.put('/mappings/:quarantineId/resolve', asyncHandler(async (req, res) => {
  const body = mappingSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body);
  const item = await prisma.syncQuarantine.findUnique({ where: { id: req.params.quarantineId } });
  if (!item) throw new AppError(404, 'Divergência não encontrada.', 'QUARANTINE_NOT_FOUND');
  setAdminScope(req, { seasonId: item.seasonId });
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'MAPPING_RESOLVED', operation: 'RESOLVE_PROVIDER_MAPPING',
    scope: { targetType: 'SyncQuarantine', targetId: item.id, seasonId: item.seasonId },
    justification: body.justification, request: { internalId: body.internalId, externalId: body.externalId }, confirmation: body,
    mutate: async (tx) => {
      const pending = await tx.syncQuarantine.findFirst({ where: { id: item.id, resolvedAt: null } });
      if (!pending) throw new AppError(409, 'Divergência já resolvida.', 'QUARANTINE_ALREADY_RESOLVED');
      const payload = objectPayload(pending.payload);
      const entityType: ProviderEntityType = pending.type === 'TEAMS' || pending.type === 'STANDINGS' ? 'TEAM' : 'MATCH';
      const externalId = body.externalId ?? (entityType === 'MATCH' && typeof payload.matchExternalId === 'string' ? payload.matchExternalId : entityType === 'TEAM' && typeof payload.teamExternalId === 'string' ? payload.teamExternalId : pending.externalId);
      if (!externalId) throw new AppError(400, 'externalId é obrigatório.', 'MAPPING_EXTERNAL_ID_REQUIRED');
      const validTarget = entityType === 'TEAM'
        ? await tx.seasonTeam.findUnique({ where: { seasonId_teamId: { seasonId: pending.seasonId, teamId: body.internalId } } })
        : await tx.match.findFirst({ where: { id: body.internalId, seasonId: pending.seasonId } });
      if (!validTarget) throw new AppError(400, 'Alvo de outra temporada.', 'INVALID_MAPPING_TARGET');
      const before = await tx.providerEntityMapping.findUnique({ where: { provider_entityType_externalId: { provider: pending.provider, entityType, externalId } } });
      const mapping = await tx.providerEntityMapping.upsert({
        where: { provider_entityType_externalId: { provider: pending.provider, entityType, externalId } },
        create: { provider: pending.provider, entityType, externalId, internalId: body.internalId, seasonId: pending.seasonId, sourceUrl: 'reconciliation://manual', collectedAt: new Date(), metadata: { provenance: 'ADMIN_MANUAL', justification: body.justification, actorId: req.session.user!.id } },
        update: { internalId: body.internalId, seasonId: pending.seasonId, sourceUrl: 'reconciliation://manual', collectedAt: new Date(), metadata: { provenance: 'ADMIN_MANUAL', justification: body.justification, actorId: req.session.user!.id } },
      });
      const resolved = await tx.syncQuarantine.update({ where: { id: pending.id }, data: { resolvedAt: new Date(), resolvedById: req.session.user!.id } });
      return { before: { mapping: before, quarantine: pending }, after: { mapping, quarantine: resolved }, result: { mapping, item: resolved }, affectedCount: 2 };
    },
  }); res.json(response);
}));

const overridePreviewSchema = manualMatchOverrideSchema.extend({ dryRun: z.literal(true).optional() }).strict();
const overrideApplySchema = manualMatchOverrideSchema.extend({ dryRun: z.literal(false).optional(), ...reinforcedConfirmationSchema.shape }).strict();

async function matchOverridePlan(seasonId: string, matchId: string, input: z.infer<typeof manualMatchOverrideSchema>) {
  const match = await prisma.match.findFirst({ where: { id: matchId, seasonId }, include: { manualOverride: true, _count: { select: { predictions: true, scores: true } } } });
  if (!match) throw new AppError(404, 'Partida não encontrada na temporada.', 'MATCH_NOT_FOUND');
  const before = { startsAt: match.startsAt.toISOString(), status: match.status, homeScore: match.homeScore, awayScore: match.awayScore, finalHomeScore: match.finalHomeScore, finalAwayScore: match.finalAwayScore };
  return { match, before, after: { ...before, ...input.values }, affectedCount: 1 + match._count.predictions + match._count.scores };
}

adminProviderRouter.post('/seasons/:seasonId/matches/:matchId/override/preview', asyncHandler(async (req, res) => {
  const body = overridePreviewSchema.parse(req.body); const plan = await matchOverridePlan(req.params.seasonId, req.params.matchId, body);
  setAdminScope(req, { seasonId: req.params.seasonId });
  res.json(await createAdminPreview({
    context: adminRequestContext(req), action: 'MATCH_OVERRIDE_APPLY',
    scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId },
    justification: body.justification, request: { values: body.values },
    preview: { before: plan.before, after: plan.after, predictions: plan.match._count.predictions, scores: plan.match._count.scores, provenance: 'ADMIN_MANUAL' },
    affectedCount: plan.affectedCount,
  }));
}));

adminProviderRouter.put('/seasons/:seasonId/matches/:matchId/override', asyncHandler(async (req, res) => {
  const body = overrideApplySchema.parse(req.body); setAdminScope(req, { seasonId: req.params.seasonId });
  let eventId: string | undefined;
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'MATCH_OVERRIDE_SET', operation: 'MATCH_OVERRIDE_APPLY',
    scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId },
    justification: body.justification, request: { values: body.values }, confirmation: body,
    mutate: async (tx) => {
      const match = await tx.match.findFirst({ where: { id: req.params.matchId, seasonId: req.params.seasonId } });
      if (!match) throw new AppError(404, 'Partida não encontrada na temporada.', 'MATCH_NOT_FOUND');
      const before = { startsAt: match.startsAt.toISOString(), status: match.status, homeScore: match.homeScore, awayScore: match.awayScore, finalHomeScore: match.finalHomeScore, finalAwayScore: match.finalAwayScore };
      const saved = await tx.match.update({ where: { id: match.id }, data: {
        ...(body.values.startsAt ? { startsAt: new Date(body.values.startsAt) } : {}),
        ...(body.values.status ? { status: body.values.status as MatchStatus } : {}),
        ...(body.values.homeScore !== undefined ? { homeScore: body.values.homeScore } : {}), ...(body.values.awayScore !== undefined ? { awayScore: body.values.awayScore } : {}),
        ...(body.values.finalHomeScore !== undefined ? { finalHomeScore: body.values.finalHomeScore } : {}), ...(body.values.finalAwayScore !== undefined ? { finalAwayScore: body.values.finalAwayScore } : {}),
      } });
      await tx.matchOverride.upsert({ where: { matchId: match.id }, create: { matchId: match.id, actorId: req.session.user!.id, justification: body.justification, values: body.values, before, active: true }, update: { actorId: req.session.user!.id, justification: body.justification, values: body.values, before, active: true, removedAt: null } });
      const event = await enqueueOutboxEvent(tx, { type: 'match.override.updated', seasonId: req.params.seasonId, poolSeasonId: null, payload: { matchId: match.id, active: true, provenance: 'ADMIN_MANUAL' }, idempotencyKey: `match.override:${adminRequestContext(req).idempotencyKey}` });
      eventId = event.id;
      return { before, after: saved, result: saved, affectedCount: 1, details: { provenance: 'ADMIN_MANUAL' } };
    },
  });
  if (eventId) await dispatchOutboxEvent(eventId);
  res.json(response);
}));

const rollbackSchema = z.object({ justification: justificationSchema }).strict();
adminProviderRouter.post('/seasons/:seasonId/matches/:matchId/override/rollback-preview', asyncHandler(async (req, res) => {
  const body = rollbackSchema.parse(req.body); const current = await prisma.matchOverride.findFirst({ where: { matchId: req.params.matchId, active: true, match: { seasonId: req.params.seasonId } } });
  if (!current) throw new AppError(404, 'Override ativo não encontrado.', 'MATCH_OVERRIDE_NOT_FOUND');
  setAdminScope(req, { seasonId: req.params.seasonId });
  res.json(await createAdminPreview({ context: adminRequestContext(req), action: 'MATCH_OVERRIDE_ROLLBACK', scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId }, justification: body.justification, request: {}, preview: { overriddenValues: current.values, restore: current.before, note: 'A precedência manual será removida e o before será restaurado.' }, affectedCount: 1 }));
}));

adminProviderRouter.post('/seasons/:seasonId/matches/:matchId/override/rollback', asyncHandler(async (req, res) => {
  const body = rollbackSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body); setAdminScope(req, { seasonId: req.params.seasonId });
  const response = await executeSensitiveMutation({ context: adminRequestContext(req), action: 'MATCH_OVERRIDE_REMOVED', operation: 'MATCH_OVERRIDE_ROLLBACK', scope: { targetType: 'Match', targetId: req.params.matchId, seasonId: req.params.seasonId }, justification: body.justification, request: {}, confirmation: body,
    mutate: async (tx) => {
      const override = await tx.matchOverride.findFirst({ where: { matchId: req.params.matchId, active: true, match: { seasonId: req.params.seasonId } } });
      if (!override) throw new AppError(404, 'Override ativo não encontrado.', 'MATCH_OVERRIDE_NOT_FOUND');
      const restore = objectPayload(override.before);
      const match = await tx.match.findFirstOrThrow({ where: { id: req.params.matchId, seasonId: req.params.seasonId } });
      const restored = await tx.match.update({ where: { id: match.id }, data: {
        ...(typeof restore.startsAt === 'string' ? { startsAt: new Date(restore.startsAt) } : {}), ...(typeof restore.status === 'string' ? { status: restore.status as MatchStatus } : {}),
        ...(Object.hasOwn(restore, 'homeScore') ? { homeScore: restore.homeScore as number | null } : {}), ...(Object.hasOwn(restore, 'awayScore') ? { awayScore: restore.awayScore as number | null } : {}),
        ...(Object.hasOwn(restore, 'finalHomeScore') ? { finalHomeScore: restore.finalHomeScore as number | null } : {}), ...(Object.hasOwn(restore, 'finalAwayScore') ? { finalAwayScore: restore.finalAwayScore as number | null } : {}),
      } });
      await tx.matchOverride.update({ where: { id: override.id }, data: { active: false, removedAt: new Date() } });
      return { before: match, after: restored, result: restored, affectedCount: 1, details: { overrideId: override.id } };
    },
  }); res.json(response);
}));
