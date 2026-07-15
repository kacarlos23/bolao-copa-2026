import { Router } from 'express';
import type { ProviderEntityType } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  createOrUpdateMatch,
  listTeams,
  listUsers,
  resetUserPassword,
  seedOfficialWorldCupData,
  setUserStatus,
} from '../services/admin.service.js';
import { prisma } from '../prisma.js';
import {
  getPredictionCloseSetting,
  updatePredictionCloseMinutes,
} from '../services/prediction-settings.service.js';
import {
  getScoreSyncSetting,
  updateScoreSyncSetting,
} from '../services/score-sync-settings.service.js';
import { CsvProvider, MAX_CSV_BYTES } from '../modules/providers/adapters/csv.provider.js';
import { ManualProvider } from '../modules/providers/adapters/manual.provider.js';
import { CbfProvider } from '../modules/providers/adapters/cbf.provider.js';
import { GeProvider } from '../modules/providers/adapters/ge.provider.js';
import { runProviderSync } from '../modules/providers/provider-sync.service.js';
import {
  removeManualMatchOverride,
  setManualMatchOverride,
} from '../modules/providers/manual-override.service.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get(
  '/settings/predictions',
  asyncHandler(async (_req, res) => {
    const setting = await getPredictionCloseSetting();
    res.json({
      predictionCloseMinutes: setting.closeMinutes,
      updatedAt: setting.updatedAt?.toISOString() ?? null,
    });
  }),
);

adminRouter.patch(
  '/settings/predictions',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ predictionCloseMinutes: z.number().int().min(1).max(120) })
      .parse(req.body);
    res.json(await updatePredictionCloseMinutes(req.session.user!.id, body.predictionCloseMinutes));
  }),
);

adminRouter.get(
  '/settings/score-sync',
  asyncHandler(async (_req, res) => {
    const setting = await getScoreSyncSetting();
    res.json({
      enabled: setting.enabled,
      updatedAt: setting.updatedAt?.toISOString() ?? null,
    });
  }),
);

adminRouter.patch(
  '/settings/score-sync',
  asyncHandler(async (req, res) => {
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    res.json(await updateScoreSyncSetting(req.session.user!.id, body.enabled));
  }),
);

adminRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    res.json({ users: await listUsers() });
  }),
);

adminRouter.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const body = z.object({ blocked: z.boolean() }).parse(req.body);
    const user = await setUserStatus(req.session.user!.id, req.params.id, body.blocked);
    res.json({ user });
  }),
);

adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const body = z.object({ password: z.string().min(6).max(128) }).parse(req.body);
    await resetUserPassword(req.session.user!.id, req.params.id, body.password);
    res.status(204).send();
  }),
);

adminRouter.get(
  '/teams',
  asyncHandler(async (_req, res) => {
    res.json({ teams: await listTeams() });
  }),
);

adminRouter.post(
  '/seed-worldcup-2026',
  asyncHandler(async (req, res) => {
    res.json(await seedOfficialWorldCupData(req.session.user!.id));
  }),
);

adminRouter.post(
  '/matches',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        homeTeamCode: z.string().min(2),
        awayTeamCode: z.string().min(2),
        startsAt: z.string().datetime({ offset: true }),
      })
      .parse(req.body);
    const match = await createOrUpdateMatch({ actorId: req.session.user!.id, ...body });
    res.status(201).json({ match });
  }),
);

adminRouter.get(
  '/sync-logs',
  asyncHandler(async (_req, res) => {
    const logs = await prisma.apiSyncLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ logs });
  }),
);

const providerSyncBaseSchema = z.object({
  seasonId: z.string().trim().min(1).max(200),
  type: z.enum(['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS']),
  dryRun: z.boolean().default(true),
  idempotencyKey: z.string().trim().min(8).max(200),
});

const providerSyncRequestSchema = z.discriminatedUnion('provider', [
  providerSyncBaseSchema.extend({ provider: z.literal('ge') }).strict(),
  providerSyncBaseSchema
    .extend({
      provider: z.literal('csv'),
      sourceDocument: z.string().trim().min(1).max(200),
      csv: z.string().min(1).max(MAX_CSV_BYTES),
    })
    .strict(),
  providerSyncBaseSchema
    .extend({ provider: z.literal('manual'), items: z.array(z.unknown()).max(50_000) })
    .strict(),
  providerSyncBaseSchema
    .extend({ provider: z.literal('cbf-official'), items: z.array(z.unknown()).max(50_000) })
    .strict(),
]);

function normalizedPayload(type: z.infer<typeof providerSyncBaseSchema>['type'], items: unknown[]) {
  if (type === 'TEAMS') return { teams: items };
  if (type === 'SCHEDULE') return { schedule: items };
  if (type === 'RESULTS') return { results: items };
  return { standings: items };
}

adminRouter.post(
  '/providers/sync',
  asyncHandler(async (req, res) => {
    const body = providerSyncRequestSchema.parse(req.body);
    const provider =
      body.provider === 'ge'
        ? new GeProvider()
        : body.provider === 'csv'
          ? new CsvProvider(body.type, body.csv, body.sourceDocument)
          : body.provider === 'cbf-official'
            ? new CbfProvider(normalizedPayload(body.type, body.items))
            : new ManualProvider(normalizedPayload(body.type, body.items));
    const result = await runProviderSync(provider, {
      type: body.type,
      seasonId: body.seasonId,
      dryRun: body.dryRun,
      idempotencyKey: body.idempotencyKey,
      requestedById: req.session.user!.id,
    });
    res.status(body.dryRun ? 200 : 202).json(result);
  }),
);

adminRouter.get(
  '/providers/sync-runs',
  asyncHandler(async (req, res) => {
    const query = z
      .object({ seasonId: z.string().min(1).optional(), provider: z.string().min(1).optional() })
      .parse(req.query);
    const runs = await prisma.providerSyncRun.findMany({
      where: { seasonId: query.seasonId, provider: query.provider },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    res.json({ runs });
  }),
);

adminRouter.get(
  '/providers/quarantine',
  asyncHandler(async (req, res) => {
    const query = z
      .object({ seasonId: z.string().min(1), unresolvedOnly: z.coerce.boolean().default(true) })
      .parse(req.query);
    const items = await prisma.syncQuarantine.findMany({
      where: { seasonId: query.seasonId, ...(query.unresolvedOnly ? { resolvedAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ items });
  }),
);

adminRouter.post(
  '/providers/quarantine/:id/resolve',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        internalId: z.string().trim().min(1).max(200),
        externalId: z.string().trim().min(1).max(200).optional(),
        justification: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    const item = await prisma.syncQuarantine.findFirst({
      where: { id: req.params.id, resolvedAt: null },
    });
    if (!item) {
      res.status(404).json({ code: 'QUARANTINE_NOT_FOUND', message: 'Quarantine item not found.' });
      return;
    }
    const payload =
      item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
        ? (item.payload as Record<string, unknown>)
        : {};
    const entityType: ProviderEntityType =
      item.type === 'TEAMS' || item.type === 'STANDINGS' ? 'TEAM' : 'MATCH';
    const externalId =
      body.externalId ??
      (entityType === 'MATCH' && typeof payload.matchExternalId === 'string'
        ? payload.matchExternalId
        : entityType === 'TEAM' && typeof payload.teamExternalId === 'string'
          ? payload.teamExternalId
          : item.externalId);
    if (!externalId) {
      res
        .status(400)
        .json({ code: 'MAPPING_EXTERNAL_ID_REQUIRED', message: 'Mapping externalId is required.' });
      return;
    }
    const targetExists =
      entityType === 'TEAM'
        ? Boolean(
            await prisma.seasonTeam.findUnique({
              where: { seasonId_teamId: { seasonId: item.seasonId, teamId: body.internalId } },
            }),
          )
        : Boolean(
            await prisma.match.findFirst({
              where: { id: body.internalId, seasonId: item.seasonId },
            }),
          );
    if (!targetExists) {
      res.status(400).json({
        code: 'INVALID_MAPPING_TARGET',
        message: 'Target does not belong to the quarantine season.',
      });
      return;
    }
    const resolved = await prisma.$transaction(async (tx) => {
      await tx.providerEntityMapping.upsert({
        where: {
          provider_entityType_externalId: { provider: item.provider, entityType, externalId },
        },
        create: {
          provider: item.provider,
          entityType,
          externalId,
          internalId: body.internalId,
          seasonId: item.seasonId,
          sourceUrl: 'reconciliation://manual',
          collectedAt: new Date(),
          metadata: { justification: body.justification, resolvedById: req.session.user!.id },
        },
        update: {
          internalId: body.internalId,
          seasonId: item.seasonId,
          sourceUrl: 'reconciliation://manual',
          collectedAt: new Date(),
          metadata: { justification: body.justification, resolvedById: req.session.user!.id },
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorId: req.session.user!.id,
          action: 'MANUAL_SYNC',
          targetId: item.id,
          details: {
            entityType,
            externalId,
            internalId: body.internalId,
            justification: body.justification,
          },
        },
      });
      return tx.syncQuarantine.update({
        where: { id: item.id },
        data: { resolvedAt: new Date(), resolvedById: req.session.user!.id },
      });
    });
    res.json({ item: resolved });
  }),
);

adminRouter.put(
  '/seasons/:seasonId/matches/:matchId/override',
  asyncHandler(async (req, res) => {
    const match = await setManualMatchOverride(
      req.params.seasonId,
      req.params.matchId,
      req.session.user!.id,
      req.body,
    );
    res.json({ match });
  }),
);

adminRouter.delete(
  '/seasons/:seasonId/matches/:matchId/override',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ justification: z.string().trim().min(10).max(500) })
      .strict()
      .parse(req.body);
    await removeManualMatchOverride(
      req.params.seasonId,
      req.params.matchId,
      req.session.user!.id,
      body.justification,
    );
    res.status(204).send();
  }),
);
