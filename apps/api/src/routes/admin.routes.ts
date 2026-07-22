import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler.js';
import { requireAdmin } from '../middleware/auth.js';
import { adminQueryRouter } from '../modules/admin/admin-query.routes.js';
import { adminResourceRouter } from '../modules/admin/admin-resource.routes.js';
import { adminProviderRouter } from '../modules/admin/admin-provider.routes.js';
import { adminJobRouter } from '../modules/admin/admin-job.routes.js';
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
import type { CbfSerieA2026Evidence } from '../modules/providers/adapters/cbf-serie-a-2026.provider.js';
import { runProviderSync } from '../modules/providers/provider-sync.service.js';
import { seasonProviderRegistry } from '../modules/providers/provider-registry.js';
import {
  assertConfiguredProvider,
  seasonProviderRuntimeConfigSchema,
} from '../modules/providers/season-runtime-config.js';
import {
  adminRequestContext,
  authorizeAdminPreview,
  createAdminPreview,
  justificationSchema,
  setAdminScope,
} from '../modules/admin/admin-security.js';
import {
  assertBrasileirao2026Readiness,
  prepareBrasileirao2026,
} from '../modules/brasileirao/brasileirao-2026.service.js';
import {
  getCompetitionFeatureFlags,
  updateCompetitionFeatureFlags,
} from '../modules/competitions/competition-feature.service.js';
import { isAuditedCompetitionFeatureMutation } from './admin-legacy-mutation.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);
adminRouter.use(adminQueryRouter);
adminRouter.use(adminResourceRouter);
adminRouter.use(adminProviderRouter);
adminRouter.use(adminJobRouter);
adminRouter.use((req, res, next) => {
  if (
    ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
    (req.method === 'POST' && req.path === '/providers/sync') ||
    isAuditedCompetitionFeatureMutation(req.method, req.path)
  ) {
    next();
    return;
  }
  res.status(410).json({
    error: {
      status: 410,
      code: 'LEGACY_ADMIN_MUTATION_DISABLED',
      message:
        'A mutação legada foi desativada. Use o fluxo administrativo com preview, justificativa e auditoria.',
      issues: [],
      requestId: String(res.locals.requestId ?? 'unavailable'),
    },
  });
});

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
  type: z.enum(['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS']),
  mode: z.enum(['DRY_RUN', 'DIFF', 'APPLY', 'VERIFY']).optional(),
  dryRun: z.boolean().default(true),
  justification: justificationSchema,
  previewId: z.string().trim().min(1).max(200).optional(),
  confirmation: z.string().trim().min(12).max(200).optional(),
});

const providerSyncRequestSchema = z
  .discriminatedUnion('provider', [
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
    providerSyncBaseSchema.extend({ provider: z.literal('cbf-serie-a-2026') }).strict(),
    providerSyncBaseSchema.extend({ provider: z.literal('conmebol-official') }).strict(),
    providerSyncBaseSchema.extend({ provider: z.literal('cbf-copa-do-brasil-official') }).strict(),
  ])
  .superRefine((body, context) => {
    const applies = body.mode ? body.mode === 'APPLY' : !body.dryRun;
    if (applies && (!body.previewId || !body.confirmation)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Apply exige previewId e confirmação reforçada.',
      });
    }
  });

function normalizedPayload(type: z.infer<typeof providerSyncBaseSchema>['type'], items: unknown[]) {
  if (type === 'TEAMS') return { teams: items };
  if (type === 'STRUCTURE') return { structure: items };
  if (type === 'TIES') return { ties: items };
  if (type === 'SCHEDULE') return { schedule: items };
  if (type === 'RESULTS') return { results: items };
  return { standings: items };
}

function providerAuthorizationRequest(body: z.infer<typeof providerSyncRequestSchema>) {
  const base = { provider: body.provider, seasonId: body.seasonId, type: body.type };
  if (body.provider === 'csv')
    return { ...base, sourceDocument: body.sourceDocument, csv: body.csv };
  if (body.provider === 'manual' || body.provider === 'cbf-official')
    return { ...base, items: body.items };
  return base;
}

adminRouter.post(
  '/providers/sync',
  asyncHandler(async (req, res) => {
    const body = providerSyncRequestSchema.parse(req.body);
    const adminContext = adminRequestContext(req);
    const authorizationRequest = providerAuthorizationRequest(body);
    setAdminScope(req, { seasonId: body.seasonId });
    let configuredRuntime: ReturnType<typeof seasonProviderRegistry.create> | null = null;
    let provider;
    if (body.provider === 'cbf-serie-a-2026') {
      const providerConfig = await assertConfiguredProvider(
        body.seasonId,
        'cbf-official',
        body.type,
      );
      configuredRuntime = seasonProviderRegistry.create(providerConfig);
      provider = configuredRuntime.provider;
    } else if (body.provider === 'ge') {
      const providerConfig = await assertConfiguredProvider(body.seasonId, 'ge', body.type);
      configuredRuntime = seasonProviderRegistry.create(providerConfig);
      provider = configuredRuntime.provider;
    } else if (body.provider === 'csv') {
      await assertConfiguredProvider(body.seasonId, 'csv', body.type);
      provider = new CsvProvider(body.type, body.csv, body.sourceDocument);
    } else if (body.provider === 'cbf-official') {
      await assertConfiguredProvider(body.seasonId, 'cbf-official', body.type);
      provider = new CbfProvider(normalizedPayload(body.type, body.items));
    } else if (body.provider === 'manual') {
      await assertConfiguredProvider(body.seasonId, 'manual', body.type);
      provider = new ManualProvider(normalizedPayload(body.type, body.items));
    } else {
      const providerConfig = await assertConfiguredProvider(
        body.seasonId,
        body.provider,
        body.type,
      );
      configuredRuntime = seasonProviderRegistry.create(providerConfig);
      provider = configuredRuntime.provider;
    }
    const mode = body.mode ?? (body.dryRun ? 'DRY_RUN' : 'APPLY');
    if (mode === 'APPLY') {
      await authorizeAdminPreview({
        context: adminContext,
        action: 'PROVIDER_SYNC_APPLY',
        scope: {
          targetType: 'ProviderSync',
          targetId: `${body.provider}:${body.type}`,
          seasonId: body.seasonId,
        },
        confirmation: { previewId: body.previewId!, confirmation: body.confirmation! },
        request: authorizationRequest,
      });
    }
    const result = await runProviderSync(provider, {
      type: body.type,
      seasonId: body.seasonId,
      mode,
      idempotencyKey: adminContext.idempotencyKey,
      requestedById: req.session.user!.id,
    });
    if (mode !== 'APPLY') {
      const authorization = await createAdminPreview({
        context: adminContext,
        action: 'PROVIDER_SYNC_APPLY',
        scope: {
          targetType: 'ProviderSync',
          targetId: `${body.provider}:${body.type}`,
          seasonId: body.seasonId,
        },
        justification: body.justification,
        request: authorizationRequest,
        preview: result,
        affectedCount: result.counts.inserted + result.counts.updated + result.counts.quarantined,
      });
      res.json({ ...result, authorization });
      return;
    }
    if (
      body.provider === 'cbf-serie-a-2026' &&
      mode === 'APPLY' &&
      ['SCHEDULE', 'RESULTS'].includes(body.type)
    ) {
      await configuredRuntime?.afterSync?.(body.seasonId);
    }
    await prisma.adminAuditLog.create({
      data: {
        actorId: adminContext.actorId,
        action: 'SYNC_REQUESTED',
        targetId: result.runId,
        requestId: adminContext.requestId,
        seasonId: body.seasonId,
        poolSeasonId: null,
        justification: body.justification,
        idempotencyKey: `audit:${adminContext.idempotencyKey}`,
        origin: adminContext.origin,
        before: { previewId: body.previewId!, checksum: result.checksum },
        after: JSON.parse(JSON.stringify(result)),
        details: {
          affectedCount: result.counts.inserted + result.counts.updated + result.counts.quarantined,
        },
      },
    });
    res.status(202).json(result);
  }),
);

adminRouter.post(
  '/brasileirao-2026/prepare',
  asyncHandler(async (req, res) => {
    const runtime = seasonProviderRegistry.create(
      seasonProviderRuntimeConfigSchema.parse({
        key: 'cbf-official',
        priority: 1,
        types: ['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS'],
        enabled: true,
        timeoutMs: 10_000,
        includeProfiles: true,
      }),
    );
    const provider = runtime.provider;
    const context = { seasonId: 'preparation', requestedById: req.session.user!.id };
    const [teams, schedule, evidence] = await Promise.all([
      provider.syncTeams(context),
      provider.syncSchedule(context),
      runtime.evidence
        ? (runtime.evidence() as Promise<CbfSerieA2026Evidence>)
        : Promise.reject(new Error('Provider de preparação sem evidência.')),
    ]);
    const readiness = assertBrasileirao2026Readiness({ teams, schedule, evidence });
    const prepared = await prepareBrasileirao2026({
      readiness,
      evidence,
      actorId: req.session.user!.id,
    });
    res.status(201).json({
      competitionId: prepared.competition.id,
      seasonId: prepared.season.id,
      stageId: prepared.stage.id,
      poolSeasonId: prepared.poolSeason.id,
      evidence,
      startsAtRound: prepared.poolSeason.startsAtRound,
      scoreableFrom: prepared.poolSeason.scoreableFrom,
    });
  }),
);

adminRouter.get(
  '/seasons/:seasonId/features',
  asyncHandler(async (req, res) => {
    res.json({ flags: await getCompetitionFeatureFlags(req.params.seasonId) });
  }),
);

adminRouter.put(
  '/seasons/:seasonId/features',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        readEnabled: z.boolean(),
        writeEnabled: z.boolean(),
        uiEnabled: z.boolean(),
        reason: z.string().trim().min(10).max(500),
      })
      .strict()
      .parse(req.body);
    res.json(
      await updateCompetitionFeatureFlags({
        seasonId: req.params.seasonId,
        actorId: req.session.user!.id,
        ...body,
      }),
    );
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
