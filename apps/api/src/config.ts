import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(24),
  INTERNAL_EVENTS_SECRET: z.string().min(24).optional(),
  SERVE_WEB_DIST: z.coerce.boolean().default(false),
  WEB_DIST_PATH: z.string().default('../web/dist'),
  LIVE_POLL_SECONDS: z.coerce.number().int().positive().default(15),
  PRE_GAME_POLL_SECONDS: z.coerce.number().int().positive().default(60),
  GAME_DAY_POLL_SECONDS: z.coerce.number().int().positive().default(300),
  IDLE_POLL_SECONDS: z.coerce.number().int().positive().default(1800),
});

export const config = envSchema.parse(process.env);
