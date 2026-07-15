import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { runGeScoreScrapeOnce } from '../services/ge-score-sync.service.js';
import { resolveWorldCupPoolContext } from '../modules/pools/world-cup-alias.js';
import { getPoolRanking, getPoolRankingAwards } from '../modules/rankings/ranking.use-cases.js';
import { legacyAliasTelemetry } from '../middleware/legacy-alias-telemetry.js';
import { WORLD_CUP_CONTEXT } from '../domain/world-cup-context.js';

export const rankingRouter = Router();
rankingRouter.use(legacyAliasTelemetry('ranking', WORLD_CUP_CONTEXT));

const rankingQuerySchema = z.object({
  period: z.enum(['all', 'week', 'day']).optional().default('all'),
});

rankingRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { period } = rankingQuerySchema.parse(req.query);
    const context = await resolveWorldCupPoolContext(req.session.user!.id);
    const result = await getPoolRanking(context, period, { page: 1, pageSize: 100 });
    res.json({ ranking: result.ranking });
  }),
);

rankingRouter.get(
  '/awards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const context = await resolveWorldCupPoolContext(req.session.user!.id);
    res.json({ awards: await getPoolRankingAwards(context) });
  }),
);

rankingRouter.post(
  '/refresh',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { period } = rankingQuerySchema.parse(req.query);
    const context = await resolveWorldCupPoolContext(req.session.user!.id);
    const sync = await runGeScoreScrapeOnce({ requestedByUserId: req.session.user!.id });
    const result = await getPoolRanking(context, period, { page: 1, pageSize: 100 });
    res.json({ ranking: result.ranking, sync });
  }),
);
