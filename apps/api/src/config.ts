import { config as loadEnvironment } from 'dotenv';
import { z } from 'zod';

const configuredEnvironmentPath = process.env.DOTENV_CONFIG_PATH?.trim();
const environmentResult = loadEnvironment(
  configuredEnvironmentPath ? { path: configuredEnvironmentPath } : undefined,
);

if (configuredEnvironmentPath && environmentResult.error) {
  throw environmentResult.error;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:8080'),
  WEB_ORIGINS: z.string().default(''),
  PRODUCTION_WEB_URL: z.string().url().optional(),
  PRODUCTION_API_URL: z.string().url().optional(),
  SESSION_COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(24),
  INTERNAL_EVENTS_SECRET: z.string().min(24).optional(),
  DOTENV_CONFIG_PATH: z.string().min(1).optional(),
  APP_RELEASE_SHA: z.string().min(1).default('development'),
  AVATAR_UPLOAD_DIR: z.string().min(1).default('./uploads/avatars'),
  SERVE_WEB_DIST: z.coerce.boolean().default(false),
  WEB_DIST_PATH: z.string().default('../web/dist'),
  LIVE_POLL_SECONDS: z.coerce.number().int().positive().default(15),
  PRE_GAME_POLL_SECONDS: z.coerce.number().int().positive().default(60),
  GAME_DAY_POLL_SECONDS: z.coerce.number().int().positive().default(300),
  IDLE_POLL_SECONDS: z.coerce.number().int().positive().default(1800),
});

export const config = envSchema.parse(process.env);
