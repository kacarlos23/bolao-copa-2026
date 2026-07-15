import { Router } from 'express';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getCupOverview } from '../services/cup.service.js';
import { WORLD_CUP_CONTEXT } from '../domain/world-cup-context.js';
import { legacyAliasTelemetry } from '../middleware/legacy-alias-telemetry.js';

export const cupRouter = Router();
cupRouter.use(legacyAliasTelemetry('cup', WORLD_CUP_CONTEXT));

cupRouter.get(
  '/overview',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getCupOverview(WORLD_CUP_CONTEXT.seasonId));
  }),
);
