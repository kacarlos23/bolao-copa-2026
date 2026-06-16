import { Router } from 'express';
import { upsertKnockoutBracketSchema } from '@bolao/shared';
import { asyncHandler } from '../http/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getPredictionBoard,
  listPublicKnockoutBrackets,
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
