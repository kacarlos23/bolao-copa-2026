import { z } from 'zod';

const externalIdSchema = z.string().trim().min(1).max(200);
const safeSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/^https?:/i.test(value), 'A source document must not be a remote URL.');

export const normalizedTeamSchema = z
  .object({
    externalId: externalIdSchema,
    name: z.string().trim().min(1).max(160),
    code: z.string().trim().min(2).max(16).optional(),
    type: z.enum(['NATIONAL_TEAM', 'CLUB']).optional(),
    crestUrl: z.string().url().max(500).optional(),
    groupName: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const normalizedMatchStatusSchema = z.enum([
  'SCHEDULED',
  'LIVE',
  'FINISHED',
  'POSTPONED',
  'CANCELLED',
]);

export const normalizedMatchSchema = z
  .object({
    externalId: externalIdSchema,
    homeTeamExternalId: externalIdSchema.optional(),
    awayTeamExternalId: externalIdSchema.optional(),
    homeTeamName: z.string().trim().min(1).max(160),
    awayTeamName: z.string().trim().min(1).max(160),
    startsAt: z.string().datetime({ offset: true }).optional(),
    status: normalizedMatchStatusSchema.default('SCHEDULED'),
    stageExternalId: externalIdSchema.optional(),
    roundExternalId: externalIdSchema.optional(),
  })
  .strict()
  .refine((value) => value.homeTeamName !== value.awayTeamName, {
    message: 'A match must contain two different teams.',
  })
  .refine(
    (value) =>
      value.startsAt !== undefined || ['POSTPONED', 'CANCELLED'].includes(value.status),
    {
      path: ['startsAt'],
      message: 'A scheduled, live, or finished match must have a start time.',
    },
  );

const optionalCardCountSchema = z.number().int().nonnegative().max(99).optional();

export const normalizedResultSchema = z
  .object({
    externalId: externalIdSchema,
    matchExternalId: externalIdSchema.optional(),
    homeTeamExternalId: externalIdSchema.optional(),
    awayTeamExternalId: externalIdSchema.optional(),
    homeTeamName: z.string().trim().min(1).max(160),
    awayTeamName: z.string().trim().min(1).max(160),
    startsAt: z.string().datetime({ offset: true }).optional(),
    homeScore: z.number().int().min(0).max(99),
    awayScore: z.number().int().min(0).max(99),
    homeYellowCards: optionalCardCountSchema,
    awayYellowCards: optionalCardCountSchema,
    homeRedCards: optionalCardCountSchema,
    awayRedCards: optionalCardCountSchema,
    status: normalizedMatchStatusSchema,
  })
  .strict();

export const normalizedStandingSchema = z
  .object({
    externalId: externalIdSchema,
    teamExternalId: externalIdSchema.optional(),
    teamName: z.string().trim().min(1).max(160),
    position: z.number().int().positive(),
    played: z.number().int().nonnegative(),
    won: z.number().int().nonnegative(),
    drawn: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    goalsFor: z.number().int().nonnegative(),
    goalsAgainst: z.number().int().nonnegative(),
    points: z.number().int(),
  })
  .strict();

export const normalizedTeamArraySchema = z.array(normalizedTeamSchema).max(10_000);
export const normalizedMatchArraySchema = z.array(normalizedMatchSchema).max(50_000);
export const normalizedResultArraySchema = z.array(normalizedResultSchema).max(50_000);
export const normalizedStandingArraySchema = z.array(normalizedStandingSchema).max(10_000);

export type NormalizedTeam = z.infer<typeof normalizedTeamSchema>;
export type NormalizedMatch = z.infer<typeof normalizedMatchSchema>;
export type NormalizedResult = z.infer<typeof normalizedResultSchema>;
export type NormalizedStanding = z.infer<typeof normalizedStandingSchema>;

export interface ProviderContext {
  seasonId: string;
  requestedById?: string | null;
}

export interface ProviderHealth {
  ok: boolean;
  checkedAt: string;
  message?: string;
}

export interface CompetitionDataProvider {
  readonly name: string;
  readonly source: string;
  syncTeams(context: ProviderContext): Promise<NormalizedTeam[]>;
  syncSchedule(context: ProviderContext): Promise<NormalizedMatch[]>;
  syncResults(context: ProviderContext): Promise<NormalizedResult[]>;
  syncStandings?(context: ProviderContext): Promise<NormalizedStanding[]>;
  healthCheck(context: ProviderContext): Promise<ProviderHealth>;
}

export function assertSafeSourceDocument(source: string) {
  return safeSourceSchema.parse(source);
}

export function normalizeEntityName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
