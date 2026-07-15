import { Router } from 'express';
import { eventsQuerySchema } from '@bolao/shared';
import { requireAuth } from '../middleware/auth.js';
import { addSseClient } from '../realtime/sse.js';
import { asyncHandler } from '../http/async-handler.js';
import { AppError } from '../http/errors.js';
import { prisma } from '../prisma.js';
import { resolveWorldCupPoolContext } from '../modules/pools/world-cup-alias.js';

export const sseRouter = Router();

sseRouter.get(
  '/events',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = eventsQuerySchema.parse(req.query);
    let context: { seasonId: string; poolSeasonId: string | null };

    if (!query.seasonId) {
      const worldCup = await resolveWorldCupPoolContext(req.session.user!.id);
      context = { seasonId: worldCup.seasonId, poolSeasonId: worldCup.poolSeasonId };
    } else if (query.poolSeasonId) {
      const poolSeason = await prisma.poolSeason.findFirst({
        where: {
          id: query.poolSeasonId,
          seasonId: query.seasonId,
          pool: {
            memberships: {
              some: { userId: req.session.user!.id, status: 'ACTIVE' },
            },
          },
        },
        select: { id: true, seasonId: true },
      });
      if (!poolSeason) {
        throw new AppError(403, 'Contexto de eventos não autorizado.', 'EVENT_CONTEXT_FORBIDDEN');
      }
      context = { seasonId: poolSeason.seasonId, poolSeasonId: poolSeason.id };
    } else {
      const season = await prisma.competitionSeason.findUnique({
        where: { id: query.seasonId },
        select: { id: true },
      });
      if (!season) throw new AppError(404, 'Temporada não encontrada.', 'SEASON_NOT_FOUND');
      context = { seasonId: season.id, poolSeasonId: null };
    }

    res.locals.seasonId = context.seasonId;
    res.locals.poolSeasonId = context.poolSeasonId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    addSseClient(res, req, context);
  }),
);
