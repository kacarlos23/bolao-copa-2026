import { Router } from 'express';
import { upsertMatchDayPredictionsSchema } from '@bolao/shared';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getMatchDay, listMatchDays } from '../services/prediction.service.js';
import { WORLD_CUP_CONTEXT } from '../domain/world-cup-context.js';
import { resolveWorldCupPoolContext } from '../modules/pools/world-cup-alias.js';
import { savePredictions } from '../modules/predictions/prediction.use-cases.js';
import { legacyAliasTelemetry } from '../middleware/legacy-alias-telemetry.js';

export const matchDayRouter = Router();

matchDayRouter.use(legacyAliasTelemetry('match-days', WORLD_CUP_CONTEXT));
matchDayRouter.use(requireAuth);

matchDayRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const context = await resolveWorldCupPoolContext(req.session.user!.id);
    res.json(await listMatchDays(req.session.user!.id, context));
  }),
);

matchDayRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const context = await resolveWorldCupPoolContext(req.session.user!.id);
    res.json(await getMatchDay(req.params.id, req.session.user!.id, context));
  }),
);

matchDayRouter.put(
  '/:id/predictions',
  asyncHandler(async (req, res) => {
    const input = upsertMatchDayPredictionsSchema.parse(req.body);
    const result = await savePredictions({
      poolSlug: WORLD_CUP_CONTEXT.poolSlug,
      seasonId: WORLD_CUP_CONTEXT.seasonId,
      userId: req.session.user!.id,
      body: { matchDayId: req.params.id, predictions: input.predictions },
    });
    res.json({ predictions: result.predictions });
  }),
);
