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
export const seasonTeamParamsSchema = z
  .object({ seasonId: entityIdSchema, teamId: entityIdSchema })
  .strict();
export const poolSeasonParamsSchema = z
  .object({ poolSlug: slugSchema, seasonId: entityIdSchema })
  .strict();

export const competitionCapabilitiesSchema = z
  .object({
    format: z.enum(['LEAGUE', 'GROUPS', 'KNOCKOUT', 'TWO_LEGS']).optional(),
    groupStage: z.boolean().optional(),
    knockoutBracket: z.boolean().optional(),
    liveScoring: z.boolean().optional(),
    standings: z.boolean().optional(),
    knockout: z.boolean().optional(),
    twoLegs: z.boolean().optional(),
    rounds: z.number().int().positive().optional(),
    teams: z.number().int().positive().optional(),
    lastFiveUnit: z.enum(['MATCH', 'ROUND']).optional(),
    rankingScopes: z
      .array(z.enum(['OVERALL', 'ROUND', 'MONTH', 'TURN']))
      .min(1)
      .optional(),
  })
  .strict();

export const listMatchesQuerySchema = paginationQuerySchema.extend({
  roundId: entityIdSchema.optional(),
  status: z.enum(['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const rankingQuerySchema = paginationQuerySchema
  .extend({
    period: z.enum(['all', 'week', 'day']).default('all'),
    scope: z.enum(['overall', 'round', 'month', 'turn']).default('overall'),
    roundId: entityIdSchema.optional(),
    month: z
      .string()
      .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/)
      .optional(),
    turn: z.coerce.number().int().min(1).max(2).optional(),
  })
  .superRefine((value, context) => {
    if (value.scope !== 'overall' && value.period !== 'all') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period'],
        message: 'period deve ser all quando um escopo de liga é informado.',
      });
    }
    const required =
      value.scope === 'round'
        ? ['roundId', value.roundId]
        : value.scope === 'month'
          ? ['month', value.month]
          : value.scope === 'turn'
            ? ['turn', value.turn]
            : null;
    if (required && required[1] == null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [String(required[0])],
        message: `${required[0]} é obrigatório para este escopo.`,
      });
    }
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
    capabilities: competitionCapabilitiesSchema.nullable(),
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
    capabilities: competitionCapabilitiesSchema.nullable(),
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

export const officialSourceDtoSchema = z
  .object({
    provider: z.literal('CBF'),
    label: z.string().trim().min(1).max(120),
    url: z.string().url(),
    collectedAt: z.string().datetime(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const seasonTeamSummaryDtoSchema = z
  .object({
    team: teamDtoSchema,
    externalId: z.string().trim().min(1).max(40),
    state: z.string().trim().length(2).nullable(),
    profileAvailable: z.boolean(),
    collectedAt: nullableDateTimeSchema,
  })
  .strict();

export const teamAthleteDtoSchema = z
  .object({
    externalId: z.string().trim().min(1).max(40),
    fullName: z.string().trim().min(1).max(180),
    nickname: z.string().trim().min(1).max(120).nullable(),
    currentClub: z
      .object({
        externalId: z.string().trim().min(1).max(40).nullable(),
        name: z.string().trim().min(1).max(180),
        state: z.string().trim().length(2).nullable(),
      })
      .strict(),
  })
  .strict();

const teamMatchSideDtoSchema = z
  .object({
    externalId: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(180),
    score: z.number().int().min(0).max(99),
  })
  .strict();

export const teamMatchHistoryDtoSchema = z
  .object({
    externalId: z.string().trim().min(1).max(40),
    reference: z.string().trim().min(1).max(40),
    round: z.number().int().min(1).max(38),
    startsAt: z.string().datetime(),
    home: teamMatchSideDtoSchema,
    away: teamMatchSideDtoSchema,
    venue: z.string().trim().min(1).max(220),
    result: z.enum(['WIN', 'DRAW', 'LOSS']),
  })
  .strict();

export const teamStatisticsDtoSchema = z
  .object({
    goalsFor: z.number().int().nonnegative(),
    goalsAgainst: z.number().int().nonnegative(),
    cleanSheets: z.number().int().nonnegative(),
    played: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    draws: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    yellowCards: z.number().int().nonnegative(),
    redCards: z.number().int().nonnegative(),
  })
  .strict();

export const teamProfileDtoSchema = z
  .object({
    seasonId: entityIdSchema,
    team: teamDtoSchema,
    externalId: z.string().trim().min(1).max(40),
    state: z.string().trim().length(2).nullable(),
    athletes: z.array(teamAthleteDtoSchema).max(150),
    matches: z.array(teamMatchHistoryDtoSchema).max(38),
    statistics: teamStatisticsDtoSchema,
    source: officialSourceDtoSchema,
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
    yellowCards: z.number().int().nonnegative(),
    redCards: z.number().int().nonnegative(),
    tieBreakRuleVersion: z.string(),
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

export const publicMatchPredictionDtoSchema = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    matchId: entityIdSchema,
    predictedHomeScore: z.number().int().min(0).max(99),
    predictedAwayScore: z.number().int().min(0).max(99),
    scoreType: z.enum(['EXACT_SCORE', 'RESULT', 'ONE_TEAM_GOALS', 'MISS']).nullable(),
    user: z
      .object({
        id: entityIdSchema,
        nickname: z.string().min(1),
        avatarUrl: z.string().nullable(),
      })
      .strict(),
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
    movement: z
      .object({
        delta: z.number().int(),
        fromRank: z.number().int().positive(),
        toRank: z.number().int().positive(),
        isProvisional: z.boolean(),
        changedAt: z.string().datetime(),
      })
      .strict()
      .nullable()
      .optional(),
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

export const competitionsResponseSchema = z
  .object({
    competitions: z.array(competitionDtoSchema),
    pagination: paginationSchema,
  })
  .strict();

export const competitionSeasonsResponseSchema = z
  .object({
    competition: competitionDtoSchema,
    seasons: z.array(seasonDtoSchema),
    pagination: paginationSchema,
  })
  .strict();

export const roundsResponseSchema = z
  .object({ rounds: z.array(roundDtoSchema), pagination: paginationSchema })
  .strict();

export const matchesResponseSchema = z
  .object({ matches: z.array(matchDtoSchema), pagination: paginationSchema })
  .strict();

export const standingsResponseSchema = z
  .object({
    standingsByGroup: z.array(
      z.object({ group: z.string(), rows: z.array(standingRowDtoSchema) }).strict(),
    ),
    pagination: paginationSchema,
  })
  .strict();

export const seasonTeamsResponseSchema = z
  .object({
    teams: z.array(seasonTeamSummaryDtoSchema).max(100),
    pagination: paginationSchema,
  })
  .strict();

export const teamProfileResponseSchema = z.object({ profile: teamProfileDtoSchema }).strict();

export const predictionsResponseSchema = z
  .object({ predictions: z.array(predictionDtoSchema), pagination: paginationSchema })
  .strict();

export const publicMatchPredictionsResponseSchema = z
  .object({
    matchId: entityIdSchema,
    predictionsCloseAt: z.string().datetime(),
    predictions: z.array(publicMatchPredictionDtoSchema),
  })
  .strict();

export const savedPredictionsResponseSchema = z
  .object({ predictions: z.array(predictionDtoSchema) })
  .strict();

export const rankingResponseSchema = z
  .object({ ranking: z.array(rankingRowDtoSchema), pagination: paginationSchema.optional() })
  .strict();

export const rankingAwardsResponseSchema = z
  .object({ awards: z.array(rankingAwardDtoSchema) })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type RankingQuery = z.infer<typeof rankingQuerySchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type CompetitionCapabilities = z.infer<typeof competitionCapabilitiesSchema>;
export type CompetitionDto = z.infer<typeof competitionDtoSchema>;
export type SeasonDto = z.infer<typeof seasonDtoSchema>;
export type StageDto = z.infer<typeof stageDtoSchema>;
export type RoundDto = z.infer<typeof roundDtoSchema>;
export type MatchDto = z.infer<typeof matchDtoSchema>;
export type TeamDto = z.infer<typeof teamDtoSchema>;
export type OfficialSourceDto = z.infer<typeof officialSourceDtoSchema>;
export type SeasonTeamSummaryDto = z.infer<typeof seasonTeamSummaryDtoSchema>;
export type TeamAthleteDto = z.infer<typeof teamAthleteDtoSchema>;
export type TeamMatchHistoryDto = z.infer<typeof teamMatchHistoryDtoSchema>;
export type TeamStatisticsDto = z.infer<typeof teamStatisticsDtoSchema>;
export type TeamProfileDto = z.infer<typeof teamProfileDtoSchema>;
export type StandingRowDto = z.infer<typeof standingRowDtoSchema>;
export type PredictionDto = z.infer<typeof predictionDtoSchema>;
export type PublicMatchPredictionDto = z.infer<typeof publicMatchPredictionDtoSchema>;
export type PublicMatchPredictionsResponse = z.infer<typeof publicMatchPredictionsResponseSchema>;
export type RankingRowDto = z.infer<typeof rankingRowDtoSchema>;
export type RankingAwardDto = z.infer<typeof rankingAwardDtoSchema>;
export type ApiIssue = z.infer<typeof apiIssueSchema>;
export type UpsertSeasonPredictionsInput = z.infer<typeof upsertSeasonPredictionsSchema>;
export type RealtimeEventEnvelope = z.infer<typeof realtimeEventEnvelopeSchema>;
export type CompetitionsResponse = z.infer<typeof competitionsResponseSchema>;
export type CompetitionSeasonsResponse = z.infer<typeof competitionSeasonsResponseSchema>;
export type RoundsResponse = z.infer<typeof roundsResponseSchema>;
export type MatchesResponse = z.infer<typeof matchesResponseSchema>;
export type StandingsResponse = z.infer<typeof standingsResponseSchema>;
export type SeasonTeamsResponse = z.infer<typeof seasonTeamsResponseSchema>;
export type TeamProfileResponse = z.infer<typeof teamProfileResponseSchema>;
export type PredictionsResponse = z.infer<typeof predictionsResponseSchema>;
export type SavedPredictionsResponse = z.infer<typeof savedPredictionsResponseSchema>;
export type RankingResponse = z.infer<typeof rankingResponseSchema>;
export type RankingAwardsResponse = z.infer<typeof rankingAwardsResponseSchema>;
