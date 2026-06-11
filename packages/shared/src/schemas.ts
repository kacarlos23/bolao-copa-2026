import { z } from 'zod';
import { USERNAME_PATTERN } from './types.js';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(USERNAME_PATTERN, 'Informe o nome real usando letras, espacos, hifen ou apostrofo.');

export const passwordSchema = z.string().min(6).max(128);

export const nicknameSchema = z.string().trim().min(2).max(40);

export const registerSchema = z.object({
  username: usernameSchema,
  nickname: nicknameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: nicknameSchema,
  password: z.string().min(1).max(128),
});

export const predictionInputSchema = z.object({
  matchId: z.string().cuid(),
  predictedHomeScore: z.number().int().min(0).max(99),
  predictedAwayScore: z.number().int().min(0).max(99),
});

export const upsertMatchDayPredictionsSchema = z.object({
  predictions: z.array(predictionInputSchema).min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpsertMatchDayPredictionsInput = z.infer<typeof upsertMatchDayPredictionsSchema>;
