import type { RequestHandler } from 'express';
import { logger } from '../logger.js';

export function legacyAliasTelemetry(
  alias: string,
  context: { seasonId: string; poolSeasonId: string | null },
): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.once('finish', () => {
      logger.info(
        {
          legacyAlias: alias,
          requestId: String(res.locals.requestId ?? req.id ?? 'unavailable'),
          method: req.method,
          path: req.originalUrl.split('?')[0],
          statusCode: res.statusCode,
          durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
          seasonId: context.seasonId,
          poolSeasonId: context.poolSeasonId,
        },
        'legacy competition alias request',
      );
    });
    next();
  };
}
