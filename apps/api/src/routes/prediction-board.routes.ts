import { Router } from 'express';
import {
  predictionInputSchema,
  upsertKnockoutBracketSchema,
  upsertKnockoutSimulationSchema,
} from '@bolao/shared';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getPredictionBoard,
  listPublicKnockoutBrackets,
  saveGroupSimulationScores,
  saveKnockoutBracket,
} from '../services/knockout.service.js';

export const predictionBoardRouter = Router();
export const knockoutBracketRouter = Router();

predictionBoardRouter.use(requireAuth);

predictionBoardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getPredictionBoard(req.session.user!.id));
  }),
);

predictionBoardRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const input = z
      .object({ groupScores: z.array(predictionInputSchema).optional() })
      .parse(req.body);
    res.json(await getPredictionBoard(req.session.user!.id, input.groupScores));
  }),
);

predictionBoardRouter.put(
  '/simulation',
  asyncHandler(async (req, res) => {
    const input = upsertKnockoutSimulationSchema.parse(req.body);
    res.json(await saveGroupSimulationScores(req.session.user!.id, input));
  }),
);

knockoutBracketRouter.use(requireAuth);

knockoutBracketRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const input = upsertKnockoutBracketSchema.parse(req.body);
    res.json(await saveKnockoutBracket(req.session.user!.id, input));
  }),
);

knockoutBracketRouter.get(
  '/public',
  asyncHandler(async (_req, res) => {
    res.json(await listPublicKnockoutBrackets());
  }),
);
