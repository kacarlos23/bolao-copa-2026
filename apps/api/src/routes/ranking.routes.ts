import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { getRanking } from '../services/ranking.service.js';
import { runGeScoreScrapeOnce } from '../services/ge-score-sync.service.js';

export const rankingRouter = Router();

const rankingQuerySchema = z.object({
  period: z.enum(['all', 'week', 'day']).optional().default('all'),
});

rankingRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { period } = rankingQuerySchema.parse(req.query);
    res.json({ ranking: await getRanking(period) });
  }),
);

rankingRouter.post(
  '/refresh',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { period } = rankingQuerySchema.parse(req.query);
    const sync = await runGeScoreScrapeOnce({ requestedByUserId: req.session.user!.id });
    res.json({ ranking: await getRanking(period), sync });
  }),
);
