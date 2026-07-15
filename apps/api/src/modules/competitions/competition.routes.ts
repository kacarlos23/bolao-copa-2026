import { Router } from 'express';
import { competitionParamsSchema, paginationQuerySchema } from '@bolao/shared';
import { asyncHandler } from '../../http/async-handler.js';
import { requireAuth } from '../../middleware/auth.js';
import { listCompetitions, listSeasonsByCompetitionSlug } from './competition.use-cases.js';

export const competitionRouter = Router();
competitionRouter.use(requireAuth);

competitionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listCompetitions(paginationQuerySchema.parse(req.query)));
  }),
);

competitionRouter.get(
  '/:slug/seasons',
  asyncHandler(async (req, res) => {
    const { slug } = competitionParamsSchema.parse(req.params);
    res.json(await listSeasonsByCompetitionSlug(slug, paginationQuerySchema.parse(req.query)));
  }),
);
