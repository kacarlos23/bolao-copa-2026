import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttpModule from 'pino-http';
import { Pool } from 'pg';
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
import {
  knockoutBracketRouter,
  predictionBoardRouter,
} from './routes/prediction-board.routes.js';
import { internalRouter } from './routes/internal.routes.js';

const PgSession = connectPgSimple(session);
const pinoHttp = pinoHttpModule as unknown as (options: { logger: typeof logger }) => express.RequestHandler;

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", 'data:', 'https:'],
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
      store:
        config.NODE_ENV === 'test'
          ? undefined
          : new PgSession({
              pool: new Pool({ connectionString: config.DATABASE_URL }),
              tableName: 'user_sessions',
              createTableIfMissing: true,
            }),
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
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
