import { Router } from 'express';
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

export const poolRouter = Router();
poolRouter.use(requireAuth);

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
    exposeResolvedContext(res.locals, context);
    res.json(await listPredictions(context, req.session.user!.id, query));
  }),
);

poolRouter.put(
  '/:poolSlug/seasons/:seasonId/predictions',
  asyncHandler(async (req, res) => {
    const params = poolSeasonParamsSchema.parse(req.params);
    exposeRequestedContext(res.locals, params);
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
    exposeResolvedContext(res.locals, context);
    res.json({ awards: await getPoolRankingAwards(context) });
  }),
);
