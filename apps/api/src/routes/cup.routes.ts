import { Router } from 'express';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getCupOverview } from '../services/cup.service.js';

export const cupRouter = Router();

cupRouter.get(
  '/overview',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await getCupOverview());
  }),
);
