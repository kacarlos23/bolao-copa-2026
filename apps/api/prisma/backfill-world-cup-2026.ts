import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CompetitionSeasonStatus,
  MatchStatus,
  PoolMembershipRole,
  PoolMembershipStatus,
  Prisma,
  PrismaClient,
  ProviderEntityType,
  RoundStatus,
  StageType,
  TeamType,
} from '@prisma/client';
import { knockoutFixtureSeeds } from '../src/data/knockout-fixtures.js';
import { worldCup2026GroupStageMatches, worldCup2026Teams } from '../src/data/world-cup-2026.js';
import { WORLD_CUP_CONTEXT } from '../src/domain/world-cup-context.js';

const prisma = new PrismaClient();

const IDS = {
  competition: WORLD_CUP_CONTEXT.competitionId,
  season: WORLD_CUP_CONTEXT.seasonId,
  groupStage: WORLD_CUP_CONTEXT.groupStageId,
  knockoutStage: WORLD_CUP_CONTEXT.knockoutStageId,
  pool: WORLD_CUP_CONTEXT.poolId,
  poolSeason: WORLD_CUP_CONTEXT.poolSeasonId,
  scoringRuleSet: WORLD_CUP_CONTEXT.scoringRuleSetId,
} as const;

const COMPETITION_SLUG = 'world-cup';
const SEASON_SLUG = 'world-cup-2026';
const POOL_SLUG = 'bolao-do-trabalho';
const SCORING_KEY = 'classic-15-3-1-0';
const SCORING_VERSION = 1;
const TERMINAL_MATCH_STATUSES = new Set<MatchStatus>([MatchStatus.FINISHED, MatchStatus.CANCELLED]);

const GROUP_ROUNDS = [
  { order: 1, name: '1ª rodada', legacyName: '1a rodada' },
  { order: 2, name: '2ª rodada', legacyName: '2a rodada' },
  { order: 3, name: '3ª rodada', legacyName: '3a rodada' },
] as const;

const KNOCKOUT_ROUNDS = [
  { order: 1, name: '32 avos de final', knockoutStage: 'ROUND_OF_32' },
  { order: 2, name: 'Oitavas de final', knockoutStage: 'ROUND_OF_16' },
  { order: 3, name: 'Quartas de final', knockoutStage: 'QUARTER_FINAL' },
  { order: 4, name: 'Semifinais', knockoutStage: 'SEMI_FINAL' },
  { order: 5, name: 'Disputa de terceiro lugar', knockoutStage: 'THIRD_PLACE' },
  { order: 6, name: 'Final', knockoutStage: 'FINAL' },
] as const;

const TOURNAMENT_START = new Date(
  Math.min(...worldCup2026GroupStageMatches.map((match) => new Date(match.startsAt).getTime())),
);
const GROUP_STAGE_END = new Date(
  Math.max(...worldCup2026GroupStageMatches.map((match) => new Date(match.startsAt).getTime())),
);
const TOURNAMENT_END = new Date(
  Math.max(...knockoutFixtureSeeds.map((fixture) => new Date(fixture.startsAt).getTime())),
);

type Transaction = Prisma.TransactionClient;

interface BackfillReport {
  formatVersion: 1;
  scope: 'world-cup-2026';
  identifiers: Record<string, string>;
  seasonStatus: CompetitionSeasonStatus;
  counts: {
    before: Record<string, number>;
    after: Record<string, number>;
    delta: Record<string, number>;
  };
  expectedScope: Record<string, number>;
  validation: {
    orphans: number;
    duplicates: number;
    crossScopeRelations: number;
  };
  preservation: {
    unchanged: boolean;
    before: PreservationState;
    after: PreservationState;
  };
}

interface PreservationState {
  combinedHash: string;
  counts: Record<string, number>;
  hashes: Record<string, string>;
}

function stableId(prefix: string, naturalKey: string) {
  const digest = createHash('sha256').update(naturalKey).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function jsonString(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value[key];
  return typeof result === 'string' && result.trim() ? result : null;
}

function predictionCloseMinutes(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 5;
  const minutes = value.minutes;
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 120
    ? minutes
    : 5;
}

function legacyRoundNumber(value: Prisma.JsonValue | null) {
  const round = jsonString(value, 'round');
  const parsed = round?.match(/([123])\s*a?\s*rodada/i)?.[1];
  return parsed ? Number(parsed) : null;
}

function roundStatus(statuses: MatchStatus[]) {
  if (statuses.length > 0 && statuses.every((status) => TERMINAL_MATCH_STATUSES.has(status))) {
    return RoundStatus.FINISHED;
  }
  if (statuses.some((status) => status === MatchStatus.LIVE || status === MatchStatus.FINISHED)) {
    return RoundStatus.ACTIVE;
  }
  return RoundStatus.SCHEDULED;
}

function dateRange(items: Array<{ startsAt: Date }>) {
  if (items.length === 0) return { startsAt: null, endsAt: null };
  return {
    startsAt: new Date(Math.min(...items.map((item) => item.startsAt.getTime()))),
    endsAt: new Date(Math.max(...items.map((item) => item.startsAt.getTime()))),
  };
}

function seasonStatus(
  matches: Array<{ status: MatchStatus }>,
  fixtures: Array<{ matchNumber: number; status: MatchStatus }>,
  now = new Date(),
) {
  const final = fixtures.find((fixture) => fixture.matchNumber === 104);
  const allStoredMatches = [...matches, ...fixtures];
  if (
    matches.length > 0 &&
    fixtures.length > 0 &&
    final &&
    TERMINAL_MATCH_STATUSES.has(final.status) &&
    allStoredMatches.every((item) => TERMINAL_MATCH_STATUSES.has(item.status))
  ) {
    return CompetitionSeasonStatus.FINISHED;
  }

  if (allStoredMatches.length > 0 || (now >= TOURNAMENT_START && now <= TOURNAMENT_END)) {
    return CompetitionSeasonStatus.ACTIVE;
  }
  return now > TOURNAMENT_END ? CompetitionSeasonStatus.FINISHED : CompetitionSeasonStatus.DRAFT;
}

function parseReportPath(argv: string[]) {
  const inline = argv.find((argument) => argument.startsWith('--report='));
  if (inline) return inline.slice('--report='.length);
  const index = argv.indexOf('--report');
  return index >= 0 ? argv[index + 1] : undefined;
}

function assertLinked(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: esperado ${expected}, encontrado ${actual}.`);
  }
}

async function preservationState(tx: Transaction): Promise<PreservationState> {
  const datasets = await Promise.all([
    tx.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    tx.team.findMany({
      select: { id: true, externalId: true, name: true, code: true, flagUrl: true, fifaRank: true },
      orderBy: { id: 'asc' },
    }),
    tx.matchDay.findMany({
      select: {
        id: true,
        date: true,
        firstMatchStartsAt: true,
        predictionsCloseAt: true,
        status: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.match.findMany({
      select: {
        id: true,
        externalId: true,
        matchDayId: true,
        homeTeamId: true,
        awayTeamId: true,
        startsAt: true,
        status: true,
        homeScore: true,
        awayScore: true,
        finalHomeScore: true,
        finalAwayScore: true,
        rawPayload: true,
        lastSyncedAt: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.prediction.findMany({
      select: {
        id: true,
        userId: true,
        matchId: true,
        predictedHomeScore: true,
        predictedAwayScore: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.predictionScore.findMany({
      select: {
        id: true,
        predictionId: true,
        matchId: true,
        userId: true,
        points: true,
        scoreType: true,
        isFinal: true,
        calculatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.knockoutFixture.findMany({
      select: {
        id: true,
        matchNumber: true,
        stage: true,
        startsAt: true,
        homeSource: true,
        awaySource: true,
        homeTeamId: true,
        awayTeamId: true,
        winnerTeamId: true,
        status: true,
        homeScore: true,
        awayScore: true,
        finalHomeScore: true,
        finalAwayScore: true,
        rawPayload: true,
        lastSyncedAt: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.knockoutGeneration.findMany({
      select: {
        id: true,
        sequence: true,
        mode: true,
        status: true,
        closesAt: true,
        resetAt: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.knockoutBracket.findMany({
      select: {
        id: true,
        userId: true,
        generationId: true,
        submittedAt: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.knockoutPick.findMany({
      select: {
        id: true,
        bracketId: true,
        fixtureId: true,
        homeTeamId: true,
        awayTeamId: true,
        advancingTeamId: true,
        predictedHomeScore: true,
        predictedAwayScore: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.knockoutGroupSimulationScore.findMany({
      select: {
        id: true,
        userId: true,
        generationId: true,
        matchId: true,
        predictedHomeScore: true,
        predictedAwayScore: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.knockoutPredictionScore.findMany({
      select: {
        id: true,
        pickId: true,
        fixtureId: true,
        userId: true,
        points: true,
        scoreType: true,
        isFinal: true,
        calculatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    tx.rankingSnapshot.findMany({
      select: {
        id: true,
        userId: true,
        points: true,
        finalPoints: true,
        exactScores: true,
        resultHits: true,
        oneGoalHits: true,
        rank: true,
        hasLiveData: true,
        calculatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
  ]);

  const names = [
    'User',
    'Team',
    'MatchDay',
    'Match',
    'Prediction',
    'PredictionScore',
    'KnockoutFixture',
    'KnockoutGeneration',
    'KnockoutBracket',
    'KnockoutPick',
    'KnockoutGroupSimulationScore',
    'KnockoutPredictionScore',
    'RankingSnapshot',
  ];
  const counts = Object.fromEntries(names.map((name, index) => [name, datasets[index].length]));
  const hashes = Object.fromEntries(names.map((name, index) => [name, hash(datasets[index])]));
  return { combinedHash: hash(hashes), counts, hashes };
}

async function reportCounts(tx: Transaction) {
  const results = await Promise.all([
    tx.competition.count(),
    tx.competitionSeason.count(),
    tx.stage.count(),
    tx.round.count(),
    tx.seasonTeam.count(),
    tx.pool.count(),
    tx.poolMembership.count(),
    tx.poolSeason.count(),
    tx.scoringRuleSet.count(),
    tx.providerEntityMapping.count(),
    tx.matchDay.count({ where: { seasonId: { not: null } } }),
    tx.match.count({ where: { seasonId: { not: null } } }),
    tx.match.count({ where: { stageId: { not: null } } }),
    tx.match.count({ where: { roundId: { not: null } } }),
    tx.prediction.count({ where: { poolSeasonId: { not: null } } }),
    tx.predictionScore.count({ where: { poolSeasonId: { not: null } } }),
    tx.knockoutFixture.count({ where: { seasonId: { not: null } } }),
    tx.knockoutGeneration.count({ where: { seasonId: { not: null } } }),
    tx.knockoutBracket.count({ where: { poolSeasonId: { not: null } } }),
    tx.rankingSnapshot.count({ where: { seasonId: { not: null } } }),
    tx.rankingSnapshot.count({ where: { poolSeasonId: { not: null } } }),
  ]);
  const names = [
    'competitions',
    'competitionSeasons',
    'stages',
    'rounds',
    'seasonTeams',
    'pools',
    'poolMemberships',
    'poolSeasons',
    'scoringRuleSets',
    'providerMappings',
    'linkedMatchDays',
    'linkedMatches',
    'matchesWithStage',
    'matchesWithRound',
    'linkedPredictions',
    'linkedPredictionScores',
    'linkedKnockoutFixtures',
    'linkedKnockoutGenerations',
    'linkedKnockoutBrackets',
    'linkedRankingSnapshotsToSeason',
    'linkedRankingSnapshotsToPoolSeason',
  ];
  return Object.fromEntries(names.map((name, index) => [name, results[index]]));
}

async function ensureCompetition(tx: Transaction) {
  const capabilities = {
    groupStage: true,
    knockoutBracket: true,
    liveScoring: true,
  };
  const existing = await tx.competition.findUnique({ where: { slug: COMPETITION_SLUG } });
  if (!existing) {
    return tx.competition.create({
      data: {
        id: IDS.competition,
        slug: COMPETITION_SLUG,
        name: 'Copa do Mundo',
        capabilities,
        metadata: { legacyDefault: true },
      },
    });
  }
  const data: Prisma.CompetitionUpdateInput = {};
  if (existing.name !== 'Copa do Mundo') data.name = 'Copa do Mundo';
  if (!sameJson(existing.capabilities, capabilities)) data.capabilities = capabilities;
  if (!sameJson(existing.metadata, { legacyDefault: true })) {
    data.metadata = { legacyDefault: true };
  }
  return Object.keys(data).length > 0
    ? tx.competition.update({ where: { id: existing.id }, data })
    : existing;
}

async function ensureSeason(
  tx: Transaction,
  competitionId: string,
  status: CompetitionSeasonStatus,
  startsAt: Date,
  endsAt: Date,
) {
  const capabilities = {
    groupStage: true,
    knockoutBracket: true,
    liveScoring: true,
  };
  const existing = await tx.competitionSeason.findUnique({
    where: { competitionId_slug: { competitionId, slug: SEASON_SLUG } },
  });
  if (!existing) {
    return tx.competitionSeason.create({
      data: {
        id: IDS.season,
        competitionId,
        slug: SEASON_SLUG,
        name: 'Copa do Mundo 2026',
        year: 2026,
        timezone: 'America/Sao_Paulo',
        status,
        startsAt,
        endsAt,
        capabilities,
        metadata: { legacyDefault: true },
      },
    });
  }
  const data: Prisma.CompetitionSeasonUpdateInput = {};
  if (existing.name !== 'Copa do Mundo 2026') data.name = 'Copa do Mundo 2026';
  if (existing.year !== 2026) data.year = 2026;
  if (existing.timezone !== 'America/Sao_Paulo') data.timezone = 'America/Sao_Paulo';
  if (existing.status !== status) data.status = status;
  if (!sameDate(existing.startsAt, startsAt)) data.startsAt = startsAt;
  if (!sameDate(existing.endsAt, endsAt)) data.endsAt = endsAt;
  if (!sameJson(existing.capabilities, capabilities)) data.capabilities = capabilities;
  if (!sameJson(existing.metadata, { legacyDefault: true })) {
    data.metadata = { legacyDefault: true };
  }
  return Object.keys(data).length > 0
    ? tx.competitionSeason.update({ where: { id: existing.id }, data })
    : existing;
}

async function ensureStage(
  tx: Transaction,
  input: {
    id: string;
    seasonId: string;
    slug: string;
    name: string;
    type: StageType;
    order: number;
  },
) {
  const existing = await tx.stage.findUnique({
    where: { seasonId_slug: { seasonId: input.seasonId, slug: input.slug } },
  });
  if (!existing) return tx.stage.create({ data: input });
  const data: Prisma.StageUpdateInput = {};
  if (existing.name !== input.name) data.name = input.name;
  if (existing.type !== input.type) data.type = input.type;
  if (existing.order !== input.order) data.order = input.order;
  return Object.keys(data).length > 0
    ? tx.stage.update({ where: { id: existing.id }, data })
    : existing;
}

async function ensureRound(
  tx: Transaction,
  input: {
    id: string;
    seasonId: string;
    stageId: string;
    name: string;
    order: number;
    status: RoundStatus;
    startsAt: Date | null;
    endsAt: Date | null;
    metadata: Prisma.InputJsonValue;
  },
) {
  const existing = await tx.round.findUnique({
    where: { stageId_order: { stageId: input.stageId, order: input.order } },
  });
  if (!existing) return tx.round.create({ data: input });
  const data: Prisma.RoundUpdateInput = {};
  if (existing.name !== input.name) data.name = input.name;
  if (existing.status !== input.status) data.status = input.status;
  if (!sameDate(existing.startsAt, input.startsAt)) data.startsAt = input.startsAt;
  if (!sameDate(existing.endsAt, input.endsAt)) data.endsAt = input.endsAt;
  if (!sameJson(existing.metadata, input.metadata)) data.metadata = input.metadata;
  return Object.keys(data).length > 0
    ? tx.round.update({ where: { id: existing.id }, data })
    : existing;
}

async function ensureScoringRuleSet(tx: Transaction) {
  const rules = {
    exactScore: { points: 15, scoreType: 'EXACT_SCORE' },
    correctResult: { points: 3, scoreType: 'RESULT' },
    oneTeamGoals: { points: 1, scoreType: 'ONE_TEAM_GOALS' },
    miss: { points: 0, scoreType: 'MISS' },
  };
  const tieBreakers = [
    { field: 'points', direction: 'desc' },
    { field: 'exactScores', direction: 'desc' },
    { field: 'resultHits', direction: 'desc' },
    { field: 'oneGoalHits', direction: 'desc' },
    { field: 'misses', direction: 'asc' },
    { field: 'nickname', direction: 'asc' },
  ];
  const existing = await tx.scoringRuleSet.findUnique({
    where: { key_version: { key: SCORING_KEY, version: SCORING_VERSION } },
  });
  if (!existing) {
    return tx.scoringRuleSet.create({
      data: {
        id: IDS.scoringRuleSet,
        key: SCORING_KEY,
        name: 'Pontuação 15/3/1/0',
        version: SCORING_VERSION,
        rules,
        tieBreakers,
        effectiveAt: TOURNAMENT_START,
        metadata: { immutable: true, legacyDefault: true },
      },
    });
  }
  const data: Prisma.ScoringRuleSetUpdateInput = {};
  if (existing.name !== 'Pontuação 15/3/1/0') data.name = 'Pontuação 15/3/1/0';
  if (!sameJson(existing.rules, rules)) data.rules = rules;
  if (!sameJson(existing.tieBreakers, tieBreakers)) data.tieBreakers = tieBreakers;
  if (!sameDate(existing.effectiveAt, TOURNAMENT_START)) data.effectiveAt = TOURNAMENT_START;
  if (!sameJson(existing.metadata, { immutable: true, legacyDefault: true })) {
    data.metadata = { immutable: true, legacyDefault: true };
  }
  return Object.keys(data).length > 0
    ? tx.scoringRuleSet.update({ where: { id: existing.id }, data })
    : existing;
}

async function ensurePool(tx: Transaction) {
  const existing = await tx.pool.findUnique({ where: { slug: POOL_SLUG } });
  if (!existing) {
    return tx.pool.create({
      data: {
        id: IDS.pool,
        slug: POOL_SLUG,
        name: 'Bolão do Trabalho',
        description: 'Bolão padrão preservado da aplicação original.',
        isPublic: false,
        metadata: { legacyDefault: true },
      },
    });
  }
  const data: Prisma.PoolUpdateInput = {};
  if (existing.name !== 'Bolão do Trabalho') data.name = 'Bolão do Trabalho';
  if (existing.description !== 'Bolão padrão preservado da aplicação original.') {
    data.description = 'Bolão padrão preservado da aplicação original.';
  }
  if (existing.isPublic) data.isPublic = false;
  if (!sameJson(existing.metadata, { legacyDefault: true })) {
    data.metadata = { legacyDefault: true };
  }
  return Object.keys(data).length > 0
    ? tx.pool.update({ where: { id: existing.id }, data })
    : existing;
}

async function ensurePoolSeason(
  tx: Transaction,
  poolId: string,
  seasonId: string,
  scoringRuleSetId: string,
) {
  const existing = await tx.poolSeason.findUnique({
    where: { poolId_seasonId: { poolId, seasonId } },
  });
  const expected = {
    scoringRuleSetId,
    scoreableFromRound: 1,
    startsAtRound: 1,
    scoreableFrom: TOURNAMENT_START,
    historicalMatchesScoreable: true,
    metadata: { legacyDefault: true },
  };
  if (!existing) {
    return tx.poolSeason.create({
      data: { id: IDS.poolSeason, poolId, seasonId, ...expected },
    });
  }
  const data: Prisma.PoolSeasonUpdateInput = {};
  if (existing.scoringRuleSetId !== scoringRuleSetId)
    data.scoringRuleSet = { connect: { id: scoringRuleSetId } };
  if (existing.scoreableFromRound !== 1) data.scoreableFromRound = 1;
  if (existing.startsAtRound !== 1) data.startsAtRound = 1;
  if (!sameDate(existing.scoreableFrom, TOURNAMENT_START)) data.scoreableFrom = TOURNAMENT_START;
  if (!existing.historicalMatchesScoreable) data.historicalMatchesScoreable = true;
  if (!sameJson(existing.metadata, expected.metadata)) data.metadata = expected.metadata;
  return Object.keys(data).length > 0
    ? tx.poolSeason.update({ where: { id: existing.id }, data })
    : existing;
}

async function main() {
  const reportPath = parseReportPath(process.argv.slice(2));
  const report = await prisma.$transaction(
    async (tx): Promise<BackfillReport> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('backfill-world-cup-2026'))`;

      const preservationBefore = await preservationState(tx);
      const countsBefore = await reportCounts(tx);
      const teamCodes = worldCup2026Teams.map((team) => team.code);
      const teams = await tx.team.findMany({
        where: {
          OR: [{ code: { in: teamCodes } }, { externalId: { startsWith: 'official:team:' } }],
        },
        orderBy: { id: 'asc' },
      });
      const teamIds = teams.map((team) => team.id);
      const matches =
        teamIds.length === 0
          ? []
          : await tx.match.findMany({
              where: {
                startsAt: { gte: TOURNAMENT_START, lte: GROUP_STAGE_END },
                homeTeamId: { in: teamIds },
                awayTeamId: { in: teamIds },
              },
              include: {
                homeTeam: { select: { code: true } },
                awayTeam: { select: { code: true } },
              },
              orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
            });
      const matchIds = matches.map((match) => match.id);
      const matchDayIds = [...new Set(matches.map((match) => match.matchDayId))];
      const fixtureNumbers = knockoutFixtureSeeds.map((fixture) => fixture.matchNumber);
      const fixtures = await tx.knockoutFixture.findMany({
        where: { matchNumber: { in: fixtureNumbers } },
        orderBy: { matchNumber: 'asc' },
      });
      const generations = await tx.knockoutGeneration.findMany({ orderBy: { sequence: 'asc' } });
      const generationIds = generations.map((generation) => generation.id);
      const closeSetting = await tx.appSetting.findUnique({
        where: { key: 'prediction.closeMinutes' },
      });
      const closeMinutes = predictionCloseMinutes(closeSetting?.value);
      const currentSeasonStatus = seasonStatus(matches, fixtures);
      const storedDates = [...matches, ...fixtures].map((item) => item.startsAt);
      const startsAt = storedDates.length
        ? new Date(Math.min(...storedDates.map((date) => date.getTime())))
        : TOURNAMENT_START;
      const endsAt = storedDates.length
        ? new Date(Math.max(...storedDates.map((date) => date.getTime())))
        : TOURNAMENT_END;

      const competition = await ensureCompetition(tx);
      const season = await ensureSeason(tx, competition.id, currentSeasonStatus, startsAt, endsAt);
      const groupStage = await ensureStage(tx, {
        id: IDS.groupStage,
        seasonId: season.id,
        slug: 'group-stage',
        name: 'Fase de grupos',
        type: StageType.GROUP,
        order: 1,
      });
      const knockoutStage = await ensureStage(tx, {
        id: IDS.knockoutStage,
        seasonId: season.id,
        slug: 'knockout',
        name: 'Mata-mata',
        type: StageType.KNOCKOUT,
        order: 2,
      });

      const seedRoundByMatch = new Map(
        worldCup2026GroupStageMatches.map((match) => [
          `${match.homeCode}:${match.awayCode}:${new Date(match.startsAt).toISOString()}`,
          Number(match.round.match(/[123]/)?.[0]),
        ]),
      );
      const matchesByRound = new Map<number, typeof matches>(
        GROUP_ROUNDS.map((round) => [round.order, []]),
      );
      for (const match of matches) {
        const seedKey = `${match.homeTeam.code}:${match.awayTeam.code}:${match.startsAt.toISOString()}`;
        const number = legacyRoundNumber(match.rawPayload) ?? seedRoundByMatch.get(seedKey);
        if (!number || !matchesByRound.has(number)) {
          throw new Error(`Rodada da partida ${match.id} não pôde ser determinada.`);
        }
        matchesByRound.get(number)!.push(match);
      }

      const groupRoundIds = new Map<number, string>();
      for (const definition of GROUP_ROUNDS) {
        const roundMatches = matchesByRound.get(definition.order) ?? [];
        const range = dateRange(roundMatches);
        const round = await ensureRound(tx, {
          id: `round-world-cup-2026-group-${definition.order}`,
          seasonId: season.id,
          stageId: groupStage.id,
          name: definition.name,
          order: definition.order,
          status: roundStatus(roundMatches.map((match) => match.status)),
          ...range,
          metadata: { legacyRound: definition.legacyName },
        });
        groupRoundIds.set(definition.order, round.id);
      }

      for (const definition of KNOCKOUT_ROUNDS) {
        const roundFixtures = fixtures.filter(
          (fixture) => fixture.stage === definition.knockoutStage,
        );
        await ensureRound(tx, {
          id: `round-world-cup-2026-knockout-${definition.order}`,
          seasonId: season.id,
          stageId: knockoutStage.id,
          name: definition.name,
          order: definition.order,
          status: roundStatus(roundFixtures.map((fixture) => fixture.status)),
          ...dateRange(roundFixtures),
          metadata: { knockoutStage: definition.knockoutStage, legacyModel: 'KnockoutFixture' },
        });
      }

      const scoringRuleSet = await ensureScoringRuleSet(tx);
      const pool = await ensurePool(tx);
      const poolSeason = await ensurePoolSeason(tx, pool.id, season.id, scoringRuleSet.id);

      const existingSeasonTeams = new Map(
        (await tx.seasonTeam.findMany({ where: { seasonId: season.id } })).map((seasonTeam) => [
          seasonTeam.teamId,
          seasonTeam,
        ]),
      );
      for (const team of teams) {
        const groupName = jsonString(team.metadata, 'group');
        const existing = existingSeasonTeams.get(team.id);
        if (!existing) {
          await tx.seasonTeam.create({
            data: {
              id: stableId('season-team', `${season.id}:${team.id}`),
              seasonId: season.id,
              teamId: team.id,
              groupName,
              metadata: { legacyExternalId: team.externalId },
            },
          });
        } else if (existing.groupName !== groupName) {
          await tx.seasonTeam.update({ where: { id: existing.id }, data: { groupName } });
        }
      }
      if (teamIds.length > 0) {
        await tx.team.updateMany({
          where: { id: { in: teamIds }, NOT: { type: TeamType.NATIONAL_TEAM } },
          data: { type: TeamType.NATIONAL_TEAM },
        });
        await tx.team.updateMany({
          where: { id: { in: teamIds }, type: null },
          data: { type: TeamType.NATIONAL_TEAM },
        });
      }

      if (matchDayIds.length > 0) {
        await tx.matchDay.updateMany({
          where: {
            id: { in: matchDayIds },
            OR: [{ seasonId: null }, { seasonId: { not: season.id } }],
          },
          data: { seasonId: season.id },
        });
      }
      for (const [number, roundMatches] of matchesByRound) {
        const ids = roundMatches.map((match) => match.id);
        if (ids.length === 0) continue;
        const roundId = groupRoundIds.get(number)!;
        await tx.match.updateMany({
          where: {
            id: { in: ids },
            OR: [
              { seasonId: null },
              { seasonId: { not: season.id } },
              { stageId: null },
              { stageId: { not: groupStage.id } },
              { roundId: null },
              { roundId: { not: roundId } },
            ],
          },
          data: { seasonId: season.id, stageId: groupStage.id, roundId },
        });
        for (const match of roundMatches) {
          const closesAt = new Date(match.startsAt.getTime() - closeMinutes * 60 * 1000);
          await tx.match.updateMany({
            where: {
              id: match.id,
              OR: [{ predictionClosesAt: null }, { predictionClosesAt: { not: closesAt } }],
            },
            data: { predictionClosesAt: closesAt },
          });
        }
      }
      if (fixtures.length > 0) {
        await tx.knockoutFixture.updateMany({
          where: {
            id: { in: fixtures.map((fixture) => fixture.id) },
            OR: [{ seasonId: null }, { seasonId: { not: season.id } }],
          },
          data: { seasonId: season.id },
        });
      }
      if (generationIds.length > 0) {
        await tx.knockoutGeneration.updateMany({
          where: {
            id: { in: generationIds },
            OR: [{ seasonId: null }, { seasonId: { not: season.id } }],
          },
          data: { seasonId: season.id },
        });
      }

      const predictions =
        matchIds.length === 0
          ? []
          : await tx.prediction.findMany({
              where: { matchId: { in: matchIds } },
              select: { id: true, userId: true },
            });
      const predictionScores =
        matchIds.length === 0
          ? []
          : await tx.predictionScore.findMany({
              where: { matchId: { in: matchIds } },
              select: { id: true, userId: true },
            });
      const brackets =
        generationIds.length === 0
          ? []
          : await tx.knockoutBracket.findMany({
              where: { generationId: { in: generationIds } },
              select: { id: true, userId: true },
            });
      const knockoutPicks =
        brackets.length === 0
          ? []
          : await tx.knockoutPick.findMany({
              where: { bracketId: { in: brackets.map((bracket) => bracket.id) } },
              select: { id: true },
            });
      const knockoutScores =
        fixtures.length === 0
          ? []
          : await tx.knockoutPredictionScore.findMany({
              where: { fixtureId: { in: fixtures.map((fixture) => fixture.id) } },
              select: { id: true, userId: true },
            });
      const simulations =
        matchIds.length === 0
          ? []
          : await tx.knockoutGroupSimulationScore.findMany({
              where: { matchId: { in: matchIds } },
              select: { id: true, userId: true },
            });
      const rankingSnapshots = await tx.rankingSnapshot.findMany({
        select: { id: true, userId: true },
      });
      const activityUserIds = new Set(
        [predictions, predictionScores, brackets, knockoutScores, simulations, rankingSnapshots]
          .flat()
          .map((item) => item.userId),
      );
      const participants = await tx.user.findMany({
        where: { OR: [{ role: 'USER' }, { id: { in: [...activityUserIds] } }] },
        orderBy: { id: 'asc' },
      });
      const memberships = new Map(
        (await tx.poolMembership.findMany({ where: { poolId: pool.id } })).map((membership) => [
          membership.userId,
          membership,
        ]),
      );
      for (const user of participants) {
        const existing = memberships.get(user.id);
        if (!existing) {
          await tx.poolMembership.create({
            data: {
              id: stableId('pool-membership', `${pool.id}:${user.id}`),
              poolId: pool.id,
              userId: user.id,
              role: PoolMembershipRole.MEMBER,
              status: PoolMembershipStatus.ACTIVE,
              joinedAt: user.createdAt,
              metadata: { legacyParticipant: true },
            },
          });
        } else if (existing.status !== PoolMembershipStatus.ACTIVE) {
          await tx.poolMembership.update({
            where: { id: existing.id },
            data: { status: PoolMembershipStatus.ACTIVE },
          });
        }
      }

      if (predictions.length > 0) {
        await tx.prediction.updateMany({
          where: {
            id: { in: predictions.map((prediction) => prediction.id) },
            OR: [{ poolSeasonId: null }, { poolSeasonId: { not: poolSeason.id } }],
          },
          data: { poolSeasonId: poolSeason.id },
        });
      }
      if (predictionScores.length > 0) {
        await tx.predictionScore.updateMany({
          where: {
            id: { in: predictionScores.map((score) => score.id) },
            OR: [{ poolSeasonId: null }, { poolSeasonId: { not: poolSeason.id } }],
          },
          data: { poolSeasonId: poolSeason.id },
        });
      }
      if (brackets.length > 0) {
        await tx.knockoutBracket.updateMany({
          where: {
            id: { in: brackets.map((bracket) => bracket.id) },
            OR: [{ poolSeasonId: null }, { poolSeasonId: { not: poolSeason.id } }],
          },
          data: { poolSeasonId: poolSeason.id },
        });
      }
      if (knockoutPicks.length > 0) {
        await tx.knockoutPick.updateMany({
          where: {
            id: { in: knockoutPicks.map((pick) => pick.id) },
            OR: [{ poolSeasonId: null }, { poolSeasonId: { not: poolSeason.id } }],
          },
          data: { poolSeasonId: poolSeason.id },
        });
      }
      if (knockoutScores.length > 0) {
        await tx.knockoutPredictionScore.updateMany({
          where: {
            id: { in: knockoutScores.map((score) => score.id) },
            OR: [{ poolSeasonId: null }, { poolSeasonId: { not: poolSeason.id } }],
          },
          data: { poolSeasonId: poolSeason.id },
        });
      }
      if (simulations.length > 0) {
        await tx.knockoutGroupSimulationScore.updateMany({
          where: {
            id: { in: simulations.map((score) => score.id) },
            OR: [{ poolSeasonId: null }, { poolSeasonId: { not: poolSeason.id } }],
          },
          data: { poolSeasonId: poolSeason.id },
        });
      }
      if (rankingSnapshots.length > 0) {
        await tx.rankingSnapshot.updateMany({
          where: {
            id: { in: rankingSnapshots.map((snapshot) => snapshot.id) },
            OR: [
              { seasonId: null },
              { seasonId: { not: season.id } },
              { poolSeasonId: null },
              { poolSeasonId: { not: poolSeason.id } },
            ],
          },
          data: { seasonId: season.id, poolSeasonId: poolSeason.id },
        });
      }

      const mappings: Prisma.ProviderEntityMappingCreateManyInput[] = [
        ...teams.map((team) => {
          const provider = team.externalId.split(':', 1)[0] || 'legacy';
          const naturalKey = `${provider}:${ProviderEntityType.TEAM}:${team.externalId}`;
          return {
            id: stableId('provider-mapping', naturalKey),
            provider,
            entityType: ProviderEntityType.TEAM,
            externalId: team.externalId,
            internalId: team.id,
            seasonId: season.id,
            metadata: { legacyField: 'Team.externalId' },
          };
        }),
        ...matches.map((match) => {
          const provider = match.externalId.split(':', 1)[0] || 'legacy';
          const naturalKey = `${provider}:${ProviderEntityType.MATCH}:${match.externalId}`;
          return {
            id: stableId('provider-mapping', naturalKey),
            provider,
            entityType: ProviderEntityType.MATCH,
            externalId: match.externalId,
            internalId: match.id,
            seasonId: season.id,
            metadata: { legacyField: 'Match.externalId', internalModel: 'Match' },
          };
        }),
        ...fixtures.map((fixture) => {
          const externalId = String(fixture.matchNumber);
          const naturalKey = `fifa:${ProviderEntityType.MATCH}:${externalId}`;
          return {
            id: stableId('provider-mapping', naturalKey),
            provider: 'fifa',
            entityType: ProviderEntityType.MATCH,
            externalId,
            internalId: fixture.id,
            seasonId: season.id,
            metadata: {
              legacyField: 'KnockoutFixture.matchNumber',
              internalModel: 'KnockoutFixture',
            },
          };
        }),
      ];
      const existingMappings = new Map(
        (await tx.providerEntityMapping.findMany()).map((mapping) => [
          `${mapping.provider}:${mapping.entityType}:${mapping.externalId}`,
          mapping,
        ]),
      );
      for (const mapping of mappings) {
        const key = `${mapping.provider}:${mapping.entityType}:${mapping.externalId}`;
        const existing = existingMappings.get(key);
        if (!existing) {
          await tx.providerEntityMapping.create({ data: mapping });
        } else if (
          existing.internalId !== mapping.internalId ||
          existing.seasonId !== mapping.seasonId ||
          !sameJson(existing.metadata, mapping.metadata)
        ) {
          await tx.providerEntityMapping.update({
            where: { id: existing.id },
            data: {
              internalId: mapping.internalId,
              seasonId: mapping.seasonId,
              metadata: mapping.metadata,
            },
          });
        }
      }

      const participantIds = participants.map((participant) => participant.id);
      const [
        linkedSeasonTeams,
        linkedMemberships,
        linkedMatchDays,
        linkedMatches,
        linkedPredictions,
        linkedPredictionScores,
        linkedFixtures,
        linkedGenerations,
        linkedBrackets,
        linkedKnockoutPicks,
        linkedKnockoutScores,
        linkedSimulations,
        linkedRankingSnapshots,
        storedMappings,
      ] = await Promise.all([
        tx.seasonTeam.count({
          where: { seasonId: season.id, teamId: { in: teamIds } },
        }),
        tx.poolMembership.count({
          where: { poolId: pool.id, userId: { in: participantIds } },
        }),
        tx.matchDay.count({
          where: { id: { in: matchDayIds }, seasonId: season.id },
        }),
        tx.match.count({
          where: {
            id: { in: matchIds },
            seasonId: season.id,
            stageId: groupStage.id,
            roundId: { not: null },
            predictionClosesAt: { not: null },
          },
        }),
        tx.prediction.count({
          where: { id: { in: predictions.map((item) => item.id) }, poolSeasonId: poolSeason.id },
        }),
        tx.predictionScore.count({
          where: {
            id: { in: predictionScores.map((item) => item.id) },
            poolSeasonId: poolSeason.id,
          },
        }),
        tx.knockoutFixture.count({
          where: { id: { in: fixtures.map((item) => item.id) }, seasonId: season.id },
        }),
        tx.knockoutGeneration.count({
          where: { id: { in: generationIds }, seasonId: season.id },
        }),
        tx.knockoutBracket.count({
          where: { id: { in: brackets.map((item) => item.id) }, poolSeasonId: poolSeason.id },
        }),
        tx.knockoutPick.count({
          where: {
            id: { in: knockoutPicks.map((item) => item.id) },
            poolSeasonId: poolSeason.id,
          },
        }),
        tx.knockoutPredictionScore.count({
          where: {
            id: { in: knockoutScores.map((item) => item.id) },
            poolSeasonId: poolSeason.id,
          },
        }),
        tx.knockoutGroupSimulationScore.count({
          where: {
            id: { in: simulations.map((item) => item.id) },
            poolSeasonId: poolSeason.id,
          },
        }),
        tx.rankingSnapshot.count({
          where: {
            id: { in: rankingSnapshots.map((item) => item.id) },
            seasonId: season.id,
            poolSeasonId: poolSeason.id,
          },
        }),
        tx.providerEntityMapping.findMany({
          select: { provider: true, entityType: true, externalId: true },
        }),
      ]);
      const storedMappingKeys = new Set(
        storedMappings.map(
          (mapping) => `${mapping.provider}:${mapping.entityType}:${mapping.externalId}`,
        ),
      );
      const linkedMappings = mappings.filter((mapping) =>
        storedMappingKeys.has(`${mapping.provider}:${mapping.entityType}:${mapping.externalId}`),
      ).length;
      assertLinked('SeasonTeam', linkedSeasonTeams, teams.length);
      assertLinked('PoolMembership', linkedMemberships, participants.length);
      assertLinked('MatchDay.seasonId', linkedMatchDays, matchDayIds.length);
      assertLinked(
        'Match.seasonId/stageId/roundId/predictionClosesAt',
        linkedMatches,
        matches.length,
      );
      assertLinked('Prediction.poolSeasonId', linkedPredictions, predictions.length);
      assertLinked('PredictionScore.poolSeasonId', linkedPredictionScores, predictionScores.length);
      assertLinked('KnockoutFixture.seasonId', linkedFixtures, fixtures.length);
      assertLinked('KnockoutGeneration.seasonId', linkedGenerations, generations.length);
      assertLinked('KnockoutBracket.poolSeasonId', linkedBrackets, brackets.length);
      assertLinked('KnockoutPick.poolSeasonId', linkedKnockoutPicks, knockoutPicks.length);
      assertLinked(
        'KnockoutPredictionScore.poolSeasonId',
        linkedKnockoutScores,
        knockoutScores.length,
      );
      assertLinked(
        'KnockoutGroupSimulationScore.poolSeasonId',
        linkedSimulations,
        simulations.length,
      );
      assertLinked(
        'RankingSnapshot.seasonId/poolSeasonId',
        linkedRankingSnapshots,
        rankingSnapshots.length,
      );
      assertLinked('ProviderEntityMapping', linkedMappings, mappings.length);

      const [orphanRows, duplicateRows, crossScopeRows] = await Promise.all([
        tx.$queryRaw<[{ orphans: number }]>`
          SELECT (
            (SELECT COUNT(*) FROM "Match" WHERE "id" = ANY(${matchIds}) AND "seasonId" IS NULL) +
            (SELECT COUNT(*) FROM "Prediction" WHERE "id" = ANY(${predictions.map((item) => item.id)}) AND "poolSeasonId" IS NULL) +
            (SELECT COUNT(*) FROM "PredictionScore" WHERE "id" = ANY(${predictionScores.map((item) => item.id)}) AND "poolSeasonId" IS NULL) +
            (SELECT COUNT(*) FROM "KnockoutPick" WHERE "id" = ANY(${knockoutPicks.map((item) => item.id)}) AND "poolSeasonId" IS NULL) +
            (SELECT COUNT(*) FROM "KnockoutGroupSimulationScore" WHERE "id" = ANY(${simulations.map((item) => item.id)}) AND "poolSeasonId" IS NULL) +
            (SELECT COUNT(*) FROM "KnockoutPredictionScore" WHERE "id" = ANY(${knockoutScores.map((item) => item.id)}) AND "poolSeasonId" IS NULL)
          )::int AS orphans
        `,
        tx.$queryRaw<[{ duplicates: number }]>`
          SELECT (
            (SELECT COUNT(*) FROM (
              SELECT "poolSeasonId", "userId", "matchId" FROM "Prediction"
              WHERE "poolSeasonId" IS NOT NULL
              GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
            ) prediction_duplicates) +
            (SELECT COUNT(*) FROM (
              SELECT "seasonId", "date" FROM "MatchDay"
              WHERE "seasonId" IS NOT NULL
              GROUP BY 1, 2 HAVING COUNT(*) > 1
            ) match_day_duplicates)
          )::int AS duplicates
        `,
        tx.$queryRaw<[{ crossScopeRelations: number }]>`
          SELECT COUNT(*)::int AS "crossScopeRelations" FROM (
            SELECT p."id" FROM "Prediction" p
            JOIN "PoolSeason" ps ON ps."id" = p."poolSeasonId"
            JOIN "Match" m ON m."id" = p."matchId"
            WHERE ps."seasonId" IS DISTINCT FROM m."seasonId"
            UNION ALL
            SELECT r."id" FROM "Round" r
            JOIN "Stage" s ON s."id" = r."stageId"
            WHERE r."seasonId" IS DISTINCT FROM s."seasonId"
            UNION ALL
            SELECT m."id" FROM "Match" m
            JOIN "Round" r ON r."id" = m."roundId"
            WHERE m."seasonId" IS DISTINCT FROM r."seasonId"
               OR m."stageId" IS DISTINCT FROM r."stageId"
            UNION ALL
            SELECT rs."id" FROM "RankingSnapshot" rs
            JOIN "PoolSeason" ps ON ps."id" = rs."poolSeasonId"
            WHERE rs."seasonId" IS DISTINCT FROM ps."seasonId"
          ) invalid_relations
        `,
      ]);
      const orphans = orphanRows[0]?.orphans ?? -1;
      const duplicates = duplicateRows[0]?.duplicates ?? -1;
      const crossScopeRelations = crossScopeRows[0]?.crossScopeRelations ?? -1;
      if (orphans !== 0 || duplicates !== 0 || crossScopeRelations !== 0) {
        throw new Error(
          `Validacao estrutural falhou: orphans=${orphans}, duplicates=${duplicates}, crossScope=${crossScopeRelations}.`,
        );
      }

      const preservationAfter = await preservationState(tx);
      if (preservationBefore.combinedHash !== preservationAfter.combinedHash) {
        throw new Error(
          'O backfill alterou IDs, palpites, resultados, pontos ou posições protegidos.',
        );
      }
      const countsAfter = await reportCounts(tx);
      const delta = Object.fromEntries(
        Object.keys(countsAfter).map((key) => [key, countsAfter[key] - countsBefore[key]]),
      );
      return {
        formatVersion: 1,
        scope: 'world-cup-2026',
        identifiers: {
          competitionId: competition.id,
          competitionSlug: competition.slug,
          seasonId: season.id,
          seasonSlug: season.slug,
          poolId: pool.id,
          poolSlug: pool.slug,
          poolSeasonId: poolSeason.id,
          scoringRuleSetId: scoringRuleSet.id,
        },
        seasonStatus: currentSeasonStatus,
        counts: { before: countsBefore, after: countsAfter, delta },
        expectedScope: {
          teams: teams.length,
          matchDays: matchDayIds.length,
          matches: matches.length,
          predictions: predictions.length,
          predictionScores: predictionScores.length,
          knockoutFixtures: fixtures.length,
          knockoutGenerations: generations.length,
          knockoutBrackets: brackets.length,
          knockoutPicks: knockoutPicks.length,
          knockoutPredictionScores: knockoutScores.length,
          knockoutGroupSimulations: simulations.length,
          rankingSnapshots: rankingSnapshots.length,
          participants: participants.length,
          providerMappings: mappings.length,
        },
        validation: { orphans, duplicates, crossScopeRelations },
        preservation: {
          unchanged: true,
          before: preservationBefore,
          after: preservationAfter,
        },
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );

  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) {
    const resolved = path.resolve(process.env.INIT_CWD ?? process.cwd(), reportPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, output, 'utf8');
  }
  process.stdout.write(output);
}

main()
  .catch((error) => {
    process.stderr.write(`Falha no backfill da Copa do Mundo 2026: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
