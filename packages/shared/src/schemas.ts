import { z } from 'zod';
import { USERNAME_PATTERN } from './types.js';

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(USERNAME_PATTERN, 'Informe o nome real usando letras, espaços, hífen ou apóstrofo.');

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

export const knockoutPickInputSchema = z.object({
  matchNumber: z.number().int().min(73).max(104),
  predictedHomeScore: z.number().int().min(0).max(99),
  predictedAwayScore: z.number().int().min(0).max(99),
  advancingTeamId: z.string().cuid(),
});

export const knockoutGroupScoreInputSchema = predictionInputSchema;

export const upsertKnockoutBracketSchema = z.object({
  picks: z.array(knockoutPickInputSchema).min(1).max(32),
  groupScores: z.array(knockoutGroupScoreInputSchema).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpsertMatchDayPredictionsInput = z.infer<typeof upsertMatchDayPredictionsSchema>;
export type UpsertKnockoutBracketInput = z.infer<typeof upsertKnockoutBracketSchema>;
