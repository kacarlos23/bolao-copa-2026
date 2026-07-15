import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import session from 'express-session';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttpModule from 'pino-http';
import type { Store } from 'express-session';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRouter } from './routes/auth.routes.js';
import { matchDayRouter } from './routes/match-day.routes.js';
import { rankingRouter } from './routes/ranking.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { sseRouter } from './routes/sse.routes.js';
import { cupRouter } from './routes/cup.routes.js';
import { avatarUploadDir } from './services/avatar.service.js';
import { knockoutBracketRouter, predictionBoardRouter } from './routes/prediction-board.routes.js';
import { internalRouter } from './routes/internal.routes.js';
import { csrfProtection } from './middleware/csrf.js';
import { requestContext } from './middleware/request-context.js';
import { competitionRouter } from './modules/competitions/competition.routes.js';
import { seasonRouter } from './modules/seasons/season.routes.js';
import { poolRouter } from './modules/pools/pool.routes.js';

const pinoHttp = pinoHttpModule as unknown as (options: {
  logger: typeof logger;
}) => express.RequestHandler;

const EXPO_ROUTER_HYDRATION_SCRIPT_HASH =
  "'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='";

export function createApp(options: { sessionStore?: Store } = {}) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          connectSrc: ["'self'", 'https://cloudflareinsights.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: [
            "'self'",
            EXPO_ROUTER_HYDRATION_SCRIPT_HASH,
            'https://static.cloudflareinsights.com',
          ],
        },
      },
    }),
  );
  app.use(compression());
  app.use(pinoHttp({ logger }));
  app.use(
    cors({
      origin: config.WEB_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'bolao.sid',
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: config.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
      store: options.sessionStore,
    }),
  );
  app.use(csrfProtection);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/competitions', competitionRouter);
  app.use('/api/seasons', seasonRouter);
  app.use('/api/pools', poolRouter);
  app.use('/api/match-days', matchDayRouter);
  app.use('/api/ranking', rankingRouter);
  app.use('/api/cup', cupRouter);
  app.use('/api/prediction-board', predictionBoardRouter);
  app.use('/api/knockout-bracket', knockoutBracketRouter);
  app.use('/api/internal', internalRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', sseRouter);
  app.use('/uploads/avatars', express.static(avatarUploadDir));

  if (config.SERVE_WEB_DIST) {
    const webDistPath = path.resolve(process.cwd(), config.WEB_DIST_PATH);
    const indexPath = path.join(webDistPath, 'index.html');

    if (fs.existsSync(indexPath)) {
      app.use(express.static(webDistPath));
      app.get('*', (_req, res) => {
        res.sendFile(indexPath);
      });
    } else {
      logger.warn({ webDistPath }, 'SERVE_WEB_DIST enabled but index.html was not found');
    }
  }

  app.use(errorHandler);

  return app;
}
