import { Router } from 'express';
import { upsertMatchDayPredictionsSchema } from '@bolao/shared';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getMatchDay, listMatchDays, upsertPredictions } from '../services/prediction.service.js';

export const matchDayRouter = Router();

matchDayRouter.use(requireAuth);

matchDayRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listMatchDays(req.session.user!.id));
  }),
);

matchDayRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await getMatchDay(req.params.id, req.session.user!.id));
  }),
);

matchDayRouter.put(
  '/:id/predictions',
  asyncHandler(async (req, res) => {
    const input = upsertMatchDayPredictionsSchema.parse(req.body);
    const predictions = await upsertPredictions(req.params.id, req.session.user!.id, input);
    res.json({ predictions });
  }),
);
