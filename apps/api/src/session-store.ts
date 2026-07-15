import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { Pool } from 'pg';
import { config } from './config.js';

const PgSession = connectPgSimple(session);

export interface SessionResources {
  store: session.Store;
  close: () => Promise<void>;
}

export function createPostgresSessionResources(): SessionResources {
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const store = new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  });
  let closePromise: Promise<void> | undefined;

  return {
    store,
    close: () => {
      closePromise ??= pool.end();
      return closePromise;
    },
  };
}
