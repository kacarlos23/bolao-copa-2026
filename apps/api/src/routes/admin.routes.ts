import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http/async-handler.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  createOrUpdateMatch,
  listTeams,
  listUsers,
  resetUserPassword,
  seedOfficialWorldCupData,
  setUserStatus,
} from '../services/admin.service.js';
import { prisma } from '../prisma.js';
import {
  getPredictionCloseSetting,
  updatePredictionCloseMinutes,
} from '../services/prediction-settings.service.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get(
  '/settings/predictions',
  asyncHandler(async (_req, res) => {
    const setting = await getPredictionCloseSetting();
    res.json({
      predictionCloseMinutes: setting.closeMinutes,
      updatedAt: setting.updatedAt?.toISOString() ?? null,
    });
  }),
);

adminRouter.patch(
  '/settings/predictions',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ predictionCloseMinutes: z.number().int().min(1).max(120) })
      .parse(req.body);
    res.json(await updatePredictionCloseMinutes(req.session.user!.id, body.predictionCloseMinutes));
  }),
);

adminRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    res.json({ users: await listUsers() });
  }),
);

adminRouter.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const body = z.object({ blocked: z.boolean() }).parse(req.body);
    const user = await setUserStatus(req.session.user!.id, req.params.id, body.blocked);
    res.json({ user });
  }),
);

adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const body = z.object({ password: z.string().min(6).max(128) }).parse(req.body);
    await resetUserPassword(req.session.user!.id, req.params.id, body.password);
    res.status(204).send();
  }),
);

adminRouter.get(
  '/teams',
  asyncHandler(async (_req, res) => {
    res.json({ teams: await listTeams() });
  }),
);

adminRouter.post(
  '/seed-worldcup-2026',
  asyncHandler(async (req, res) => {
    res.json(await seedOfficialWorldCupData(req.session.user!.id));
  }),
);

adminRouter.post(
  '/matches',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        homeTeamCode: z.string().min(2),
        awayTeamCode: z.string().min(2),
        startsAt: z.string().datetime({ offset: true }),
      })
      .parse(req.body);
    const match = await createOrUpdateMatch({ actorId: req.session.user!.id, ...body });
    res.status(201).json({ match });
  }),
);

adminRouter.get(
  '/sync-logs',
  asyncHandler(async (_req, res) => {
    const logs = await prisma.apiSyncLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ logs });
  }),
);
