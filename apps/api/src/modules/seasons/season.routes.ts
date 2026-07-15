import { Router } from 'express';
import {
  listMatchesQuerySchema,
  paginationQuerySchema,
  seasonParamsSchema,
} from '@bolao/shared';
import { asyncHandler } from '../../http/async-handler.js';
import { requireAuth } from '../../middleware/auth.js';
import { listSeasonMatches } from '../matches/match.use-cases.js';
import { listSeasonRounds } from '../rounds/round.use-cases.js';
import { listSeasonStages } from '../stages/stage.use-cases.js';
import { getSeason } from './season.use-cases.js';
import { getSeasonStandings } from '../standings/standing.use-cases.js';
import {
  assertCompetitionFeature,
  getCompetitionFeatureFlags,
} from '../competitions/competition-feature.service.js';

export const seasonRouter = Router();
seasonRouter.use(requireAuth);

seasonRouter.get(
  '/:seasonId/features',
  asyncHandler(async (req, res) => {
    const { seasonId } = seasonParamsSchema.parse(req.params);
    const flags = await getCompetitionFeatureFlags(seasonId);
    res.json({ uiEnabled: flags.uiEnabled });
  }),
);

seasonRouter.get(
  '/:seasonId',
  asyncHandler(async (req, res) => {
    const { seasonId } = seasonParamsSchema.parse(req.params);
    res.locals.seasonId = seasonId;
    await assertCompetitionFeature(seasonId, 'read', req.session.user!.role);
    const [season, stages] = await Promise.all([getSeason(seasonId), listSeasonStages(seasonId)]);
    res.json({ season, stages });
  }),
);

seasonRouter.get(
  '/:seasonId/rounds',
  asyncHandler(async (req, res) => {
    const { seasonId } = seasonParamsSchema.parse(req.params);
    res.locals.seasonId = seasonId;
    await assertCompetitionFeature(seasonId, 'read', req.session.user!.role);
    res.json(await listSeasonRounds(seasonId, paginationQuerySchema.parse(req.query)));
  }),
);

seasonRouter.get(
  '/:seasonId/matches',
  asyncHandler(async (req, res) => {
    const { seasonId } = seasonParamsSchema.parse(req.params);
    res.locals.seasonId = seasonId;
    await assertCompetitionFeature(seasonId, 'read', req.session.user!.role);
    res.json(await listSeasonMatches(seasonId, listMatchesQuerySchema.parse(req.query)));
  }),
);

seasonRouter.get(
  '/:seasonId/standings',
  asyncHandler(async (req, res) => {
    const { seasonId } = seasonParamsSchema.parse(req.params);
    res.locals.seasonId = seasonId;
    await assertCompetitionFeature(seasonId, 'read', req.session.user!.role);
    res.json(await getSeasonStandings(seasonId, paginationQuerySchema.parse(req.query)));
  }),
);
