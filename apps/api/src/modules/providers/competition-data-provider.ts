import { z } from 'zod';

const externalIdSchema = z.string().trim().min(1).max(240);
const nullableMetadataSchema = z.record(z.unknown()).optional();
const countryCodeSchema = z.string().trim().min(2).max(3).toUpperCase();
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
    countryCode: countryCodeSchema.optional(),
    federation: z.string().trim().min(1).max(120).optional(),
    providerMetadata: nullableMetadataSchema,
  })
  .strict();

export const normalizedStageSchema = z
  .object({
    kind: z.literal('STAGE'),
    externalId: externalIdSchema,
    slug: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    type: z.enum(['LEAGUE', 'GROUP', 'KNOCKOUT']),
    order: z.number().int().positive(),
    metadata: nullableMetadataSchema,
  })
  .strict();

export const normalizedRoundSchema = z
  .object({
    kind: z.literal('ROUND'),
    externalId: externalIdSchema,
    stageExternalId: externalIdSchema,
    name: z.string().trim().min(1).max(160),
    order: z.number().int().positive(),
    status: z.enum(['SCHEDULED', 'ACTIVE', 'FINISHED']).default('SCHEDULED'),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
    metadata: nullableMetadataSchema,
  })
  .strict()
  .refine(
    (round) =>
      !round.startsAt || !round.endsAt || new Date(round.endsAt) >= new Date(round.startsAt),
    { path: ['endsAt'], message: 'Round end must not precede its start.' },
  );

export const normalizedStructureEntitySchema = z.union([
  normalizedStageSchema,
  normalizedRoundSchema,
]);

export const normalizedMatchStatusSchema = z.enum([
  'SCHEDULED',
  'LIVE',
  'FINISHED',
  'POSTPONED',
  'CANCELLED',
]);

export const normalizedVenueSchema = z
  .object({
    name: z.string().trim().min(1).max(220),
    city: z.string().trim().min(1).max(160).optional(),
    countryCode: countryCodeSchema.optional(),
  })
  .strict();

export const normalizedMatchSchema = z
  .object({
    externalId: externalIdSchema,
    homeTeamExternalId: externalIdSchema.optional(),
    awayTeamExternalId: externalIdSchema.optional(),
    homeTeamName: z.string().trim().min(1).max(160),
    awayTeamName: z.string().trim().min(1).max(160),
    startsAt: z.string().datetime({ offset: true }).optional(),
    kickoffConfirmed: z.boolean().default(true),
    status: normalizedMatchStatusSchema.default('SCHEDULED'),
    stageExternalId: externalIdSchema.optional(),
    roundExternalId: externalIdSchema.optional(),
    tieExternalId: externalIdSchema.optional(),
    legNumber: z.union([z.literal(1), z.literal(2)]).optional(),
    groupName: z.string().trim().min(1).max(40).optional(),
    venue: normalizedVenueSchema.optional(),
    providerMetadata: nullableMetadataSchema,
  })
  .strict()
  .refine((value) => value.homeTeamName !== value.awayTeamName, {
    message: 'A match must contain two different teams.',
  })
  .refine(
    (value) =>
      value.startsAt !== undefined ||
      !value.kickoffConfirmed ||
      ['POSTPONED', 'CANCELLED'].includes(value.status),
    {
      path: ['startsAt'],
      message: 'A scheduled, live, or finished match must have a start time.',
    },
  )
  .refine((value) => (value.tieExternalId === undefined) === (value.legNumber === undefined), {
    path: ['legNumber'],
    message: 'tieExternalId and legNumber must be provided together.',
  });

const optionalScoreSchema = z.number().int().min(0).max(99).optional();
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
    regulationHomeScore: optionalScoreSchema,
    regulationAwayScore: optionalScoreSchema,
    extraTimeHomeScore: optionalScoreSchema,
    extraTimeAwayScore: optionalScoreSchema,
    penaltyHomeScore: optionalScoreSchema,
    penaltyAwayScore: optionalScoreSchema,
    homeYellowCards: optionalCardCountSchema,
    awayYellowCards: optionalCardCountSchema,
    homeRedCards: optionalCardCountSchema,
    awayRedCards: optionalCardCountSchema,
    status: normalizedMatchStatusSchema,
    providerMetadata: nullableMetadataSchema,
  })
  .strict()
  .superRefine((result, context) => {
    for (const [homeField, awayField] of [
      ['regulationHomeScore', 'regulationAwayScore'],
      ['extraTimeHomeScore', 'extraTimeAwayScore'],
      ['penaltyHomeScore', 'penaltyAwayScore'],
    ] as const) {
      if ((result[homeField] === undefined) !== (result[awayField] === undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [homeField],
          message: `${homeField} and ${awayField} must be provided together.`,
        });
      }
    }
    if (
      (result.extraTimeHomeScore !== undefined || result.penaltyHomeScore !== undefined) &&
      result.regulationHomeScore === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['regulationHomeScore'],
        message: 'Extra time or penalties require the regulation score.',
      });
    }
  });

export const normalizedTieSchema = z
  .object({
    externalId: externalIdSchema,
    key: z.string().trim().min(1).max(128),
    order: z.number().int().positive(),
    stageExternalId: externalIdSchema,
    roundExternalId: externalIdSchema,
    teamAExternalId: externalIdSchema.optional(),
    teamBExternalId: externalIdSchema.optional(),
    teamAName: z.string().trim().min(1).max(160),
    teamBName: z.string().trim().min(1).max(160),
    expectedLegs: z.union([z.literal(1), z.literal(2)]),
    status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'DECIDED', 'CANCELLED']).default('SCHEDULED'),
    decisionMethod: z
      .enum(['AGGREGATE', 'EXTRA_TIME', 'PENALTIES', 'WALKOVER', 'ADMINISTRATIVE'])
      .optional(),
    winnerTeamExternalId: externalIdSchema.optional(),
    provenance: z.string().trim().min(1).max(500),
    metadata: nullableMetadataSchema,
  })
  .strict()
  .refine((tie) => tie.teamAName !== tie.teamBName, {
    path: ['teamBName'],
    message: 'A tie must contain two different teams.',
  })
  .refine(
    (tie) =>
      tie.status !== 'DECIDED' ||
      (tie.winnerTeamExternalId !== undefined && tie.decisionMethod !== undefined),
    {
      path: ['winnerTeamExternalId'],
      message: 'A decided tie requires a winner and decision method.',
    },
  );

export const normalizedStandingSchema = z
  .object({
    externalId: externalIdSchema,
    teamExternalId: externalIdSchema.optional(),
    teamName: z.string().trim().min(1).max(160),
    groupName: z.string().trim().min(1).max(40).optional(),
    position: z.number().int().positive(),
    played: z.number().int().nonnegative(),
    won: z.number().int().nonnegative(),
    drawn: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    goalsFor: z.number().int().nonnegative(),
    goalsAgainst: z.number().int().nonnegative(),
    points: z.number().int(),
    qualification: z
      .enum(['QUALIFIED', 'PLAYOFF', 'TRANSFERRED', 'ELIMINATED', 'PENDING'])
      .optional(),
    providerMetadata: nullableMetadataSchema,
  })
  .strict();

export const normalizedTeamArraySchema = z.array(normalizedTeamSchema).max(10_000);
export const normalizedStructureArraySchema = z.array(normalizedStructureEntitySchema).max(10_000);
export const normalizedTieArraySchema = z.array(normalizedTieSchema).max(20_000);
export const normalizedMatchArraySchema = z.array(normalizedMatchSchema).max(50_000);
export const normalizedResultArraySchema = z.array(normalizedResultSchema).max(50_000);
export const normalizedStandingArraySchema = z.array(normalizedStandingSchema).max(10_000);

export type NormalizedTeam = z.infer<typeof normalizedTeamSchema>;
export type NormalizedStage = z.infer<typeof normalizedStageSchema>;
export type NormalizedRound = z.infer<typeof normalizedRoundSchema>;
export type NormalizedStructureEntity = z.infer<typeof normalizedStructureEntitySchema>;
export type NormalizedMatch = z.infer<typeof normalizedMatchSchema>;
export type NormalizedResult = z.infer<typeof normalizedResultSchema>;
export type NormalizedTie = z.infer<typeof normalizedTieSchema>;
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

export interface ProviderSnapshotEvidence {
  provider: string;
  competition: string;
  season: string;
  source: string;
  collectedAt: string;
  checksum: string;
  byteLength: number;
  artifacts: Array<{
    kind: 'PAGE' | 'PDF' | 'RESPONSE';
    source: string;
    contentType: string;
    checksum: string;
    byteLength: number;
  }>;
}

export interface CompetitionDataProvider {
  readonly name: string;
  readonly source: string;
  syncTeams(context: ProviderContext): Promise<NormalizedTeam[]>;
  syncStructure?(context: ProviderContext): Promise<NormalizedStructureEntity[]>;
  syncTies?(context: ProviderContext): Promise<NormalizedTie[]>;
  syncSchedule(context: ProviderContext): Promise<NormalizedMatch[]>;
  syncResults(context: ProviderContext): Promise<NormalizedResult[]>;
  syncStandings?(context: ProviderContext): Promise<NormalizedStanding[]>;
  snapshotEvidence?(): Promise<ProviderSnapshotEvidence>;
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
