import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  poolSeasonParamsSchema,
  predictionsQuerySchema,
  rankingQuerySchema,
  upsertSeasonPredictionsSchema,
} from '@bolao/shared';
import { asyncHandler } from '../../http/async-handler.js';
import { requireAuth } from '../../middleware/auth.js';
import { listPredictions, savePredictions } from '../predictions/prediction.use-cases.js';
import { getPoolRanking, getPoolRankingAwards } from '../rankings/ranking.use-cases.js';
import { resolvePoolSeasonContext } from './pool-context.js';
import { assertCompetitionFeature } from '../competitions/competition-feature.service.js';
import { resolvePoolSeasonRules } from '../scoring/scoring-rules.service.js';
import {
  getEngagementDashboard,
  markInboxRead,
  rankingVisitSummary,
  updateNotificationPreferences,
} from '../engagement/engagement.service.js';

export const poolRouter = Router();
poolRouter.use(requireAuth);

const notificationPreferenceSchema = z.object({
  inAppEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  timezone: z.string().min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.quietHoursEnabled && (!value.quietHoursStart || !value.quietHoursEnd)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Início e fim são obrigatórios para quiet hours.' });
  }
});

async function engagementContext(req: Request, res: Response) {
  const params = poolSeasonParamsSchema.parse(req.params);
  exposeRequestedContext(res.locals, params);
  const context = await resolvePoolSeasonContext({ ...params, userId: req.session.user!.id });
  await assertCompetitionFeature(context.seasonId, 'read', req.session.user!.role);
  exposeResolvedContext(res.locals, context);
  return context;
}

poolRouter.get(
  '/:poolSlug/seasons/:seasonId/rules',
  asyncHandler(async (req, res) => {
    const context = await engagementContext(req, res);
    res.json(await resolvePoolSeasonRules(context.poolSeasonId));
  }),
);

poolRouter.get(
  '/:poolSlug/seasons/:seasonId/engagement',
  asyncHandler(async (req, res) => {
    const context = await engagementContext(req, res);
    res.json(await getEngagementDashboard(context.poolSeasonId, req.session.user!.id));
  }),
);

poolRouter.patch(
  '/:poolSlug/seasons/:seasonId/notifications/preferences',
  asyncHandler(async (req, res) => {
    const context = await engagementContext(req, res);
    res.json({ preferences: await updateNotificationPreferences(context.poolSeasonId, req.session.user!.id, notificationPreferenceSchema.parse(req.body)) });
  }),
);

poolRouter.post(
  '/:poolSlug/seasons/:seasonId/notifications/:notificationId/read',
  asyncHandler(async (req, res) => {
    const context = await engagementContext(req, res);
    const notificationId = z.string().cuid().parse(req.params.notificationId);
    await markInboxRead(context.poolSeasonId, req.session.user!.id, notificationId);
    res.status(204).end();
  }),
);

poolRouter.post(
  '/:poolSlug/seasons/:seasonId/ranking/visit',
  asyncHandler(async (req, res) => {
    const context = await engagementContext(req, res);
    res.json({ summary: await rankingVisitSummary(context.poolSeasonId, req.session.user!.id) });
  }),
);

function exposeRequestedContext(
  locals: Record<string, unknown>,
  params: { poolSlug: string; seasonId: string },
) {
  locals.poolSlug = params.poolSlug;
  locals.seasonId = params.seasonId;
}

function exposeResolvedContext(
  locals: Record<string, unknown>,
  context: Awaited<ReturnType<typeof resolvePoolSeasonContext>>,
) {
  locals.poolSeasonId = context.poolSeasonId;
}

poolRouter.get(
  '/:poolSlug/seasons/:seasonId/ranking',
  asyncHandler(async (req, res) => {
    const params = poolSeasonParamsSchema.parse(req.params);
    exposeRequestedContext(res.locals, params);
    const query = rankingQuerySchema.parse(req.query);
    const context = await resolvePoolSeasonContext({ ...params, userId: req.session.user!.id });
    await assertCompetitionFeature(context.seasonId, 'read', req.session.user!.role);
    exposeResolvedContext(res.locals, context);
    res.json(await getPoolRanking(context, query.period, query));
  }),
);

poolRouter.get(
  '/:poolSlug/seasons/:seasonId/predictions',
  asyncHandler(async (req, res) => {
    const params = poolSeasonParamsSchema.parse(req.params);
    exposeRequestedContext(res.locals, params);
    const query = predictionsQuerySchema.parse(req.query);
    const context = await resolvePoolSeasonContext({ ...params, userId: req.session.user!.id });
    await assertCompetitionFeature(context.seasonId, 'read', req.session.user!.role);
    exposeResolvedContext(res.locals, context);
    res.json(await listPredictions(context, req.session.user!.id, query));
  }),
);

poolRouter.put(
  '/:poolSlug/seasons/:seasonId/predictions',
  asyncHandler(async (req, res) => {
    const params = poolSeasonParamsSchema.parse(req.params);
    exposeRequestedContext(res.locals, params);
    await assertCompetitionFeature(params.seasonId, 'write', req.session.user!.role);
    const body = upsertSeasonPredictionsSchema.parse(req.body);
    const result = await savePredictions({ ...params, userId: req.session.user!.id, body });
    exposeResolvedContext(res.locals, result.context);
    res.json({ predictions: result.predictions });
  }),
);

poolRouter.get(
  '/:poolSlug/seasons/:seasonId/awards',
  asyncHandler(async (req, res) => {
    const params = poolSeasonParamsSchema.parse(req.params);
    exposeRequestedContext(res.locals, params);
    const context = await resolvePoolSeasonContext({ ...params, userId: req.session.user!.id });
    await assertCompetitionFeature(context.seasonId, 'read', req.session.user!.role);
    exposeResolvedContext(res.locals, context);
    res.json({ awards: await getPoolRankingAwards(context) });
  }),
);
