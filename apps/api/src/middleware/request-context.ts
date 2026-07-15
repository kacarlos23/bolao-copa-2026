import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { logger } from '../logger.js';

const SAFE_REQUEST_ID = /^[a-zA-Z0-9._:-]{1,128}$/;

export const requestContext: RequestHandler = (req, res, next) => {
  const provided = req.get('x-request-id');
  const requestId = provided && SAFE_REQUEST_ID.test(provided) ? provided : randomUUID();
  const startedAt = process.hrtime.bigint();
  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  res.once('finish', () => {
    if (!res.locals.seasonId && !res.locals.poolSeasonId) return;
    logger.info(
      {
        requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        seasonId: res.locals.seasonId,
        poolSeasonId: res.locals.poolSeasonId,
        poolSlug: res.locals.poolSlug,
      },
      'competition context request',
    );
  });
  next();
};
