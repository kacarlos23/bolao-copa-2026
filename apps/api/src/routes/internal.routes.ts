import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { asyncHandler } from '../http/async-handler.js';
import { AppError } from '../http/errors.js';
import { emitSse } from '../realtime/sse.js';

const syncCompletedSchema = z.object({
  ranking: z.array(z.record(z.unknown())),
  updatedMatchIds: z.array(z.string()),
  updatedKnockoutFixtureIds: z.array(z.string()),
  updatedAt: z.string().datetime(),
});

function hasValidSecret(value: string | undefined) {
  if (!value) return false;
  const expected = Buffer.from(config.INTERNAL_EVENTS_SECRET ?? config.SESSION_SECRET);
  const received = Buffer.from(value);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export const internalRouter = Router();

internalRouter.post(
  '/realtime/sync-completed',
  asyncHandler(async (req, res) => {
    if (!hasValidSecret(req.get('x-internal-events-secret'))) {
      throw new AppError(401, 'Credencial interna inv?lida.', 'INVALID_INTERNAL_SECRET');
    }

    const body = syncCompletedSchema.parse(req.body);
    emitSse('ranking.updated', { ranking: body.ranking, updatedAt: body.updatedAt });
    emitSse('prediction-board.updated', {
      matchIds: body.updatedMatchIds,
      knockoutFixtureIds: body.updatedKnockoutFixtureIds,
      updatedAt: body.updatedAt,
    });
    res.json({ ok: true });
  }),
);
