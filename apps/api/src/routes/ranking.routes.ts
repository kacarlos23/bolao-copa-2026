import { Router } from 'express';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getRanking } from '../services/ranking.service.js';

export const rankingRouter = Router();

rankingRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ ranking: await getRanking() });
  }),
);
