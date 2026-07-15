import { z } from 'zod';

export const entityIdSchema = z.string().trim().min(1).max(128);
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const paginationSchema = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();

export const competitionParamsSchema = z.object({ slug: slugSchema }).strict();
export const seasonParamsSchema = z.object({ seasonId: entityIdSchema }).strict();
export const poolSeasonParamsSchema = z
  .object({ poolSlug: slugSchema, seasonId: entityIdSchema })
  .strict();

export const listMatchesQuerySchema = paginationQuerySchema.extend({
  roundId: entityIdSchema.optional(),
  status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const rankingQuerySchema = paginationQuerySchema.extend({
  period: z.enum(['all', 'week', 'day']).default('all'),
});

export const predictionsQuerySchema = paginationQuerySchema.extend({
  matchDayId: entityIdSchema.optional(),
});

export const eventsQuerySchema = z
  .object({
    seasonId: entityIdSchema.optional(),
    poolSeasonId: entityIdSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.poolSeasonId && !value.seasonId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['seasonId'],
        message: 'seasonId é obrigatório com poolSeasonId.',
      });
    }
  });

export const genericPredictionInputSchema = z
  .object({
    matchId: entityIdSchema,
    predictedHomeScore: z.number().int().min(0).max(99),
    predictedAwayScore: z.number().int().min(0).max(99),
  })
  .strict();

export const upsertSeasonPredictionsSchema = z
  .object({
    matchDayId: entityIdSchema,
    predictions: z.array(genericPredictionInputSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, prediction] of value.predictions.entries()) {
      if (ids.has(prediction.matchId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['predictions', index, 'matchId'],
          message: 'Partida duplicada no lote.',
        });
      }
      ids.add(prediction.matchId);
    }
  });

const nullableDateTimeSchema = z.string().datetime().nullable();

export const competitionDtoSchema = z
  .object({
    id: entityIdSchema,
    slug: slugSchema,
    name: z.string(),
    capabilities: z.unknown().nullable(),
  })
  .strict();

export const seasonDtoSchema = z
  .object({
    id: entityIdSchema,
    competitionId: entityIdSchema,
    slug: slugSchema,
    name: z.string(),
    year: z.number().int().nullable(),
    timezone: z.string(),
    status: z.enum(['DRAFT', 'ACTIVE', 'FINISHED', 'ARCHIVED']),
    startsAt: nullableDateTimeSchema,
    endsAt: nullableDateTimeSchema,
    capabilities: z.unknown().nullable(),
  })
  .strict();

export const stageDtoSchema = z
  .object({
    id: entityIdSchema,
    seasonId: entityIdSchema,
    slug: slugSchema,
    name: z.string(),
    type: z.enum(['LEAGUE', 'GROUP', 'KNOCKOUT']),
    order: z.number().int(),
  })
  .strict();

export const roundDtoSchema = z
  .object({
    id: entityIdSchema,
    seasonId: entityIdSchema,
    stageId: entityIdSchema,
    name: z.string(),
    order: z.number().int(),
    status: z.enum(['SCHEDULED', 'ACTIVE', 'FINISHED']),
    startsAt: nullableDateTimeSchema,
    endsAt: nullableDateTimeSchema,
    stage: z.object({ id: entityIdSchema, name: z.string(), type: z.string() }).strict(),
  })
  .strict();

export const teamDtoSchema = z
  .object({
    id: entityIdSchema,
    name: z.string(),
    code: z.string().nullable(),
    flagUrl: z.string().nullable(),
    crestUrl: z.string().nullable(),
  })
  .strict();

export const matchDtoSchema = z
  .object({
    id: entityIdSchema,
    seasonId: entityIdSchema,
    stageId: entityIdSchema.nullable(),
    roundId: entityIdSchema.nullable(),
    matchDayId: entityIdSchema,
    startsAt: z.string().datetime(),
    predictionClosesAt: nullableDateTimeSchema,
    status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED']),
    homeScore: z.number().int().nullable(),
    awayScore: z.number().int().nullable(),
    finalHomeScore: z.number().int().nullable(),
    finalAwayScore: z.number().int().nullable(),
    homeTeam: teamDtoSchema,
    awayTeam: teamDtoSchema,
  })
  .strict();

export const standingRowDtoSchema = z
  .object({
    rank: z.number().int().positive(),
    group: z.string(),
    team: teamDtoSchema,
    played: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    draws: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    goalsFor: z.number().int().nonnegative(),
    goalsAgainst: z.number().int().nonnegative(),
    goalDifference: z.number().int(),
    points: z.number().int().nonnegative(),
    lastFive: z.array(z.enum(['W', 'D', 'L'])).max(5),
  })
  .strict();

export const predictionDtoSchema = z
  .object({
    id: entityIdSchema,
    poolSeasonId: entityIdSchema,
    userId: entityIdSchema,
    matchId: entityIdSchema,
    predictedHomeScore: z.number().int().min(0).max(99),
    predictedAwayScore: z.number().int().min(0).max(99),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const rankingRowDtoSchema = z
  .object({
    rank: z.number().int().positive(),
    userId: entityIdSchema,
    nickname: z.string(),
    avatarUrl: z.string().nullable(),
    points: z.number().int(),
    finalPoints: z.number().int(),
    played: z.number().int().nonnegative(),
    exactScores: z.number().int().nonnegative(),
    resultHits: z.number().int().nonnegative(),
    oneGoalHits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    lastFive: z.array(z.number().int()).max(5),
    lastFiveMatches: z
      .array(z.object({ score: z.number().int(), match: z.unknown().optional() }).strict())
      .max(5),
    hasLiveData: z.boolean(),
  })
  .strict();

export const rankingAwardWinnerDtoSchema = z
  .object({
    userId: entityIdSchema,
    nickname: z.string(),
    avatarUrl: z.string().nullable().optional(),
    points: z.number().int(),
    exactScores: z.number().int().nonnegative(),
    resultHits: z.number().int().nonnegative(),
    oneGoalHits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
  })
  .strict();

export const rankingAwardDtoSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    subtitle: z.string(),
    scope: z.enum(['GROUP_ROUND', 'GROUP_STAGE', 'KNOCKOUT_BRACKET', 'KNOCKOUT_STAGE', 'OVERALL']),
    tier: z.enum(['standard', 'major', 'legendary']),
    status: z.enum(['pending', 'live', 'locked', 'empty']),
    icon: z.string(),
    winner: rankingAwardWinnerDtoSchema.optional(),
  })
  .strict();

export const apiIssueSchema = z
  .object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })
  .strict();

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        status: z.number().int().min(400).max(599),
        code: z.string(),
        message: z.string(),
        issues: z.array(apiIssueSchema),
        requestId: z.string(),
      })
      .strict(),
  })
  .strict();

export const realtimeEventEnvelopeSchema = z
  .object({
    eventId: entityIdSchema,
    type: z.string().min(1).max(100),
    occurredAt: z.string().datetime(),
    seasonId: entityIdSchema,
    poolSeasonId: entityIdSchema.nullable(),
    version: z.number().int().positive(),
    payload: z.record(z.unknown()),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type CompetitionDto = z.infer<typeof competitionDtoSchema>;
export type SeasonDto = z.infer<typeof seasonDtoSchema>;
export type StageDto = z.infer<typeof stageDtoSchema>;
export type RoundDto = z.infer<typeof roundDtoSchema>;
export type MatchDto = z.infer<typeof matchDtoSchema>;
export type TeamDto = z.infer<typeof teamDtoSchema>;
export type StandingRowDto = z.infer<typeof standingRowDtoSchema>;
export type PredictionDto = z.infer<typeof predictionDtoSchema>;
export type RankingRowDto = z.infer<typeof rankingRowDtoSchema>;
export type RankingAwardDto = z.infer<typeof rankingAwardDtoSchema>;
export type UpsertSeasonPredictionsInput = z.infer<typeof upsertSeasonPredictionsSchema>;
export type RealtimeEventEnvelope = z.infer<typeof realtimeEventEnvelopeSchema>;
