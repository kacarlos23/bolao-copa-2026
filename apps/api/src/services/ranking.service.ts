import { Prisma, type KnockoutStage, type ScoreType } from '@prisma/client';
import { calculatePredictionScore, compareByTieBreakers } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { WORLD_CUP_CONTEXT } from '../domain/world-cup-context.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../modules/events/outbox.js';
import { isPoolMatchScoreable } from '../modules/predictions/scoreability.js';
import {
  resolvePoolSeasonRules,
  scoreCalculationKey,
  stableHash,
} from '../modules/scoring/scoring-rules.service.js';
import { recomputePoolSeasonEngagement } from '../modules/engagement/engagement.service.js';
import { serializableTransaction } from '../prisma-transaction.js';

export type RankingPeriod = 'all' | 'week' | 'day';
export type RankingScope =
  | { scope?: 'overall' }
  | { scope: 'round'; roundId: string }
  | { scope: 'month'; month: string }
  | { scope: 'turn'; turn: 1 | 2 };

export interface RankingContext {
  seasonId: string;
  poolId: string;
  poolSeasonId: string;
}

const DEFAULT_RANKING_CONTEXT: RankingContext = WORLD_CUP_CONTEXT;

export type RankingAwardScope =
  | 'GROUP_ROUND'
  | 'GROUP_STAGE'
  | 'KNOCKOUT_BRACKET'
  | 'KNOCKOUT_STAGE'
  | 'OVERALL';
export type RankingAwardTier = 'standard' | 'major' | 'legendary';
export type RankingAwardStatus = 'pending' | 'live' | 'locked' | 'empty';

export interface RankingAwardWinner {
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  points: number;
  exactScores: number;
  resultHits: number;
  oneGoalHits: number;
  misses: number;
}

export interface RankingAward {
  key: string;
  title: string;
  subtitle: string;
  scope: RankingAwardScope;
  tier: RankingAwardTier;
  status: RankingAwardStatus;
  icon: string;
  winner?: RankingAwardWinner;
}

export interface RankingRowBase {
  nickname: string;
  points: number;
  exactScores: number;
  resultHits: number;
  oneGoalHits: number;
  misses: number;
}

export interface RankingAwardScoreInput {
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  points: number;
  isFinal: boolean;
  scoreType: ScoreType;
}

export const RANKING_SNAPSHOT_RETENTION_DAYS = 90;

export function rankingSnapshotRetentionCutoff(calculatedAt: Date) {
  return new Date(calculatedAt.getTime() - RANKING_SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

type AwardWinnerAccumulator = RankingAwardWinner & {
  played: number;
  hasLiveData: boolean;
};

type ScopeItem = {
  status: string;
};

const EXPECTED_GROUP_MATCHES = 72;
const EXPECTED_KNOCKOUT_FIXTURES = 32;
const EXPECTED_STAGE_FIXTURES: Record<KnockoutStage, number> = {
  ROUND_OF_32: 16,
  ROUND_OF_16: 8,
  QUARTER_FINAL: 4,
  SEMI_FINAL: 2,
  THIRD_PLACE: 1,
  FINAL: 1,
};

export function compareRankingRows(a: RankingRowBase, b: RankingRowBase) {
  return compareByTieBreakers(a, b);
}

export function buildAwardWinner(scores: RankingAwardScoreInput[]) {
  const byUser = new Map<string, AwardWinnerAccumulator>();

  for (const score of scores) {
    const row =
      byUser.get(score.userId) ??
      ({
        userId: score.userId,
        nickname: score.nickname,
        avatarUrl: score.avatarUrl,
        points: 0,
        exactScores: 0,
        resultHits: 0,
        oneGoalHits: 0,
        misses: 0,
        played: 0,
        hasLiveData: false,
      } satisfies AwardWinnerAccumulator);

    row.points += score.points;
    row.played += 1;
    row.hasLiveData = row.hasLiveData || !score.isFinal;

    if (score.scoreType === 'EXACT_SCORE') row.exactScores += 1;
    if (score.scoreType === 'RESULT') row.resultHits += 1;
    if (score.scoreType === 'ONE_TEAM_GOALS') row.oneGoalHits += 1;
    if (score.scoreType === 'MISS') row.misses += 1;

    byUser.set(score.userId, row);
  }

  const winner = [...byUser.values()].sort(compareRankingRows)[0];
  if (!winner) return undefined;

  return {
    userId: winner.userId,
    nickname: winner.nickname,
    avatarUrl: winner.avatarUrl,
    points: winner.points,
    exactScores: winner.exactScores,
    resultHits: winner.resultHits,
    oneGoalHits: winner.oneGoalHits,
    misses: winner.misses,
  } satisfies RankingAwardWinner;
}

export async function recalculateScoresForMatch(
  matchId: string,
  options: { refreshRanking?: boolean; poolSeasonId?: string } = {},
) {
  const committed = await serializableTransaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: {
        round: { select: { order: true } },
        predictions: {
          where: options.poolSeasonId ? { poolSeasonId: options.poolSeasonId } : undefined,
          orderBy: { id: 'asc' },
          include: {
            score: true,
            poolSeason: {
              select: {
                id: true,
                poolId: true,
                seasonId: true,
                scoreableFromRound: true,
                scoreableFrom: true,
                startsAtRound: true,
                historicalMatchesScoreable: true,
              },
            },
          },
        },
      },
    });
    if (!match) return { contexts: [] as RankingContext[], eventIds: [] as string[] };

    const contexts = new Map<string, RankingContext>();
    const eventIds: string[] = [];
    const sourceRevision = match.updatedAt.toISOString();
    const actualHomeScore = match.status === 'FINISHED' ? match.finalHomeScore : match.homeScore;
    const actualAwayScore = match.status === 'FINISHED' ? match.finalAwayScore : match.awayScore;
    const unavailable = ['POSTPONED', 'CANCELLED'].includes(match.status) || actualHomeScore == null || actualAwayScore == null;

    for (const prediction of match.predictions) {
      const poolSeasonId = prediction.poolSeasonId ?? WORLD_CUP_CONTEXT.poolSeasonId;
      const poolContext = prediction.poolSeason
        ? { poolSeasonId, poolId: prediction.poolSeason.poolId, seasonId: prediction.poolSeason.seasonId }
        : WORLD_CUP_CONTEXT;
      contexts.set(poolSeasonId, poolContext);
      const ruleSet = (await resolvePoolSeasonRules(poolSeasonId, tx)).scoring;
      const beforeScore = prediction.score ? {
        points: prediction.score.points,
        scoreType: prediction.score.scoreType,
        isFinal: prediction.score.isFinal,
        scoringRuleSetVersionId: prediction.score.scoringRuleSetVersionId,
        scoringVersion: prediction.score.scoringVersion,
        breakdown: prediction.score.breakdown,
        calculationKey: prediction.score.calculationKey,
        resultRevision: prediction.score.resultRevision,
        calculatedAt: prediction.score.calculatedAt.toISOString(),
      } as Prisma.InputJsonValue : Prisma.JsonNull;
      const scoreable = !unavailable && isPoolMatchScoreable(prediction.poolSeason, {
        roundOrder: match.round?.order ?? null,
        startsAt: match.startsAt,
      });

      if (!scoreable) {
        if (prediction.score) {
          const idempotencyKey = stableHash({ targetId: prediction.id, sourceRevision, before: prediction.score.calculationKey, after: null });
          await tx.scoreRecomputationAudit.createMany({
            data: [{ poolSeasonId, userId: prediction.userId, targetType: 'MATCH_PREDICTION', targetId: prediction.id, sourceRevision, scoringRuleSetVersionId: ruleSet.id, before: beforeScore, after: Prisma.JsonNull, reason: unavailable ? 'RESULT_UNAVAILABLE' : 'NOT_SCOREABLE', idempotencyKey }],
            skipDuplicates: true,
          });
          await tx.predictionScore.delete({ where: { predictionId: prediction.id } });
        }
        continue;
      }

      const isFinal = match.status === 'FINISHED';
      const result = calculatePredictionScore({
        predictedHomeScore: prediction.predictedHomeScore,
        predictedAwayScore: prediction.predictedAwayScore,
        actualHomeScore: actualHomeScore!,
        actualAwayScore: actualAwayScore!,
      }, ruleSet);
      const calculationKey = scoreCalculationKey({ targetId: prediction.id, resultRevision: sourceRevision, scoringRuleSetVersionId: ruleSet.id, actualHomeScore: actualHomeScore!, actualAwayScore: actualAwayScore!, isFinal, predictionIdentity: { home: prediction.predictedHomeScore, away: prediction.predictedAwayScore } });
      if (prediction.score?.calculationKey === calculationKey) continue;
      const next = { points: result.points, scoreType: result.scoreType, isFinal, scoringRuleSetVersionId: ruleSet.id, scoringVersion: ruleSet.version, breakdown: result.breakdown as unknown as Prisma.InputJsonValue, calculationKey, resultRevision: sourceRevision };
      const auditKey = stableHash({ targetId: prediction.id, sourceRevision, before: prediction.score?.calculationKey ?? null, after: calculationKey });

      await tx.predictionScore.upsert({
        where: { predictionId: prediction.id },
        update: { ...next, poolSeasonId, calculatedAt: match.updatedAt },
        create: { ...next, predictionId: prediction.id, matchId: match.id, userId: prediction.userId, poolSeasonId, calculatedAt: match.updatedAt },
      });
      await tx.scoreRecomputationAudit.createMany({
        data: [{ poolSeasonId, userId: prediction.userId, targetType: 'MATCH_PREDICTION', targetId: prediction.id, sourceRevision, scoringRuleSetVersionId: ruleSet.id, before: beforeScore, after: next as unknown as Prisma.InputJsonValue, reason: prediction.score ? 'RESULT_CORRECTION_OR_REPLAY' : 'INITIAL_CALCULATION', idempotencyKey: auditKey }],
        skipDuplicates: true,
      });
      const event = await enqueueOutboxEvent(tx, {
        type: 'score.recomputed', seasonId: poolContext.seasonId, poolSeasonId,
        payload: { matchId, predictionId: prediction.id, isFinal, scoringVersion: ruleSet.version },
        idempotencyKey: `score.recomputed:${auditKey}`,
      });
      eventIds.push(event.id);
    }
    return { contexts: [...contexts.values()], eventIds };
  });

  for (const eventId of committed.eventIds) await dispatchOutboxEvent(eventId);
  if (options.refreshRanking !== false) {
    for (const context of committed.contexts) {
      await refreshRankingSnapshot(context);
      await recomputePoolSeasonEngagement(context.poolSeasonId);
    }
  }
}

function saoPauloDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function addCivilDays(value: { year: number; month: number; day: number }, amount: number) {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day));
  next.setUTCDate(next.getUTCDate() + amount);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function toSaoPauloMidnight(value: { year: number; month: number; day: number }) {
  const year = String(value.year);
  const month = String(value.month).padStart(2, '0');
  const day = String(value.day).padStart(2, '0');
  return new Date(`${year}-${month}-${day}T00:00:00-03:00`);
}

function rankingWindow(period: RankingPeriod) {
  if (period === 'all') return null;

  const today = saoPauloDateParts();
  if (period === 'day') {
    return {
      start: toSaoPauloMidnight(today),
      end: toSaoPauloMidnight(addCivilDays(today, 1)),
    };
  }

  const civilDate = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const weekday = civilDate.getUTCDay() || 7;
  const weekStart = addCivilDays(today, 1 - weekday);
  return {
    start: toSaoPauloMidnight(weekStart),
    end: toSaoPauloMidnight(addCivilDays(weekStart, 7)),
  };
}

function monthWindow(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const next = monthNumber === 12 ? { year: year + 1, month: 1 } : { year, month: monthNumber + 1 };
  return {
    start: new Date(`${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}-01T00:00:00-03:00`),
    end: new Date(`${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}-01T00:00:00-03:00`),
  };
}

function rankingMatchFilter(period: RankingPeriod, selection: RankingScope) {
  const scope = selection.scope ?? 'overall';
  const window =
    scope === 'month'
      ? monthWindow((selection as Extract<RankingScope, { scope: 'month' }>).month)
      : rankingWindow(period);
  return {
    ...(window ? { startsAt: { gte: window.start, lt: window.end } } : {}),
    ...(scope === 'round'
      ? { roundId: (selection as Extract<RankingScope, { scope: 'round' }>).roundId }
      : {}),
    ...(scope === 'turn'
      ? {
          round: {
            order:
              (selection as Extract<RankingScope, { scope: 'turn' }>).turn === 1
                ? { gte: 1, lte: 19 }
                : { gte: 20, lte: 38 },
          },
        }
      : {}),
  };
}

function jsonString(value: Prisma.JsonValue | null | undefined, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value[key];
  return typeof raw === 'string' ? raw : null;
}

function groupRoundNumber(value: Prisma.JsonValue | null | undefined) {
  const round = jsonString(value, 'round')?.trim().toLowerCase();
  if (!round) return null;
  if (round.startsWith('1') || round.includes('rodada 1')) return 1;
  if (round.startsWith('2') || round.includes('rodada 2')) return 2;
  if (round.startsWith('3') || round.includes('rodada 3')) return 3;
  return null;
}

function buildAwardStatus(
  items: ScopeItem[],
  scores: RankingAwardScoreInput[],
  expectedItems?: number,
): RankingAwardStatus {
  if (items.length === 0) return 'empty';

  const scheduleComplete = expectedItems == null || items.length >= expectedItems;
  const allFinished = scheduleComplete && items.every((item) => item.status === 'FINISHED');
  const hasLiveItem = items.some((item) => item.status === 'LIVE');

  if (scores.length === 0) return hasLiveItem ? 'live' : 'pending';
  if (allFinished) return 'locked';
  return 'live';
}

function buildOverallAwardStatus(
  groupMatches: ScopeItem[],
  knockoutFixtures: ScopeItem[],
  scores: RankingAwardScoreInput[],
): RankingAwardStatus {
  const items = [...groupMatches, ...knockoutFixtures];
  if (items.length === 0) return 'empty';
  if (scores.length === 0) return items.some((item) => item.status === 'LIVE') ? 'live' : 'pending';

  const scheduleComplete =
    groupMatches.length >= EXPECTED_GROUP_MATCHES &&
    knockoutFixtures.length >= EXPECTED_KNOCKOUT_FIXTURES;
  const allFinished = scheduleComplete && items.every((item) => item.status === 'FINISHED');
  return allFinished ? 'locked' : 'live';
}

function makeAward(input: {
  key: string;
  title: string;
  subtitle: string;
  scope: RankingAwardScope;
  tier: RankingAwardTier;
  status: RankingAwardStatus;
  icon: string;
  scores: RankingAwardScoreInput[];
}): RankingAward {
  const winner = buildAwardWinner(input.scores);
  return {
    key: input.key,
    title: input.title,
    subtitle: input.subtitle,
    scope: input.scope,
    tier: input.tier,
    status: input.status,
    icon: input.icon,
    ...(winner ? { winner } : {}),
  };
}

function buildRankingRows(
  users: Array<{
    id: string;
    nickname: string;
    avatarUrl: string | null;
    scores: Array<{
      points: number;
      isFinal: boolean;
      scoreType: ScoreType;
      calculatedAt: Date;
      match?: {
        homeTeam: {
          id: string;
          name: string;
          code?: string | null;
          metadata?: Prisma.JsonValue | null;
        } | null;
        awayTeam: {
          id: string;
          name: string;
          code?: string | null;
          metadata?: Prisma.JsonValue | null;
        } | null;
        homeScore?: number | null;
        awayScore?: number | null;
        finalHomeScore?: number | null;
        finalAwayScore?: number | null;
        status: string;
      };
    }>;
    knockoutScores: Array<{
      points: number;
      isFinal: boolean;
      scoreType: ScoreType;
      calculatedAt: Date;
      fixture?: {
        homeTeam: {
          id: string;
          name: string;
          code?: string | null;
          metadata?: Prisma.JsonValue | null;
        } | null;
        awayTeam: {
          id: string;
          name: string;
          code?: string | null;
          metadata?: Prisma.JsonValue | null;
        } | null;
        homeScore?: number | null;
        awayScore?: number | null;
        finalHomeScore?: number | null;
        finalAwayScore?: number | null;
        status: string;
      };
    }>;
  }>,
  period: RankingPeriod,
) {
  const rows = users
    .map((user) => {
      const scores = [
        ...user.scores.map((score) => ({ ...score, event: score.match })),
        ...user.knockoutScores.map((score) => ({ ...score, event: score.fixture })),
      ].sort((a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime());
      const points = scores.reduce((sum, score) => sum + score.points, 0);
      const finalPoints = scores
        .filter((score) => score.isFinal)
        .reduce((sum, score) => sum + score.points, 0);
      const lastFiveScores = scores.slice(0, 5).reverse();
      return {
        userId: user.id,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        points,
        finalPoints,
        played: scores.length,
        exactScores: scores.filter((score) => score.scoreType === 'EXACT_SCORE').length,
        resultHits: scores.filter((score) => score.scoreType === 'RESULT').length,
        oneGoalHits: scores.filter((score) => score.scoreType === 'ONE_TEAM_GOALS').length,
        misses: scores.filter((score) => score.scoreType === 'MISS').length,
        lastFive: lastFiveScores.map((score) => score.points),
        lastFiveMatches: lastFiveScores.map((score) => ({
          score: score.points,
          match: score.event,
        })),
        hasLiveData: scores.some((score) => !score.isFinal),
      };
    })
    .filter((row) => period === 'all' || row.played > 0);

  const sorted = rows.sort((left, right) => compareRankingRows(left, right) || left.userId.localeCompare(right.userId));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || compareRankingRows(sorted[index - 1], row) !== 0) rank = index + 1;
    return { rank, ...row };
  });
}

export async function getRanking(
  period: RankingPeriod = 'all',
  context: RankingContext = DEFAULT_RANKING_CONTEXT,
  selection: RankingScope = { scope: 'overall' },
) {
  const matchFilter = rankingMatchFilter(period, selection);
  const includeKnockout = (selection.scope ?? 'overall') === 'overall';
  const users = await prisma.user.findMany({
    where: {
      role: 'USER',
      status: 'ACTIVE',
      poolMemberships: { some: { poolId: context.poolId, status: 'ACTIVE' } },
    },
    select: {
      id: true,
      nickname: true,
      avatarUrl: true,
      scores: {
        where: {
          poolSeasonId: context.poolSeasonId,
          match: {
            seasonId: context.seasonId,
            ...matchFilter,
          },
        },
        orderBy: { calculatedAt: 'desc' },
        select: {
          points: true,
          isFinal: true,
          scoreType: true,
          calculatedAt: true,
          match: {
            select: {
              id: true,
              homeTeam: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  metadata: true,
                },
              },
              awayTeam: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  metadata: true,
                },
              },
              homeScore: true,
              awayScore: true,
              finalHomeScore: true,
              finalAwayScore: true,
              status: true,
            },
          },
        },
      },
      knockoutScores: {
        where: {
          poolSeasonId: context.poolSeasonId,
          fixture: {
            seasonId: context.seasonId,
            ...(!includeKnockout ? { id: '__league-scope-excludes-knockout__' } : matchFilter),
          },
        },
        orderBy: { calculatedAt: 'desc' },
        select: {
          points: true,
          isFinal: true,
          scoreType: true,
          calculatedAt: true,
          fixture: {
            select: {
              id: true,
              homeTeam: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  metadata: true,
                },
              },
              awayTeam: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  metadata: true,
                },
              },
              homeScore: true,
              awayScore: true,
              finalHomeScore: true,
              finalAwayScore: true,
              status: true,
            },
          },
        },
      },
    },
  });

  const result = buildRankingRows(users, period);
  return result;
}

export async function getRankingAwards(context: RankingContext = DEFAULT_RANKING_CONTEXT) {
  const [overallRanking, users, groupMatches, knockoutFixtures] = await Promise.all([
    getRanking('all', context),
    prisma.user.findMany({
      where: {
        role: 'USER',
        status: 'ACTIVE',
        poolMemberships: { some: { poolId: context.poolId, status: 'ACTIVE' } },
      },
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        scores: {
          where: {
            poolSeasonId: context.poolSeasonId,
            match: { seasonId: context.seasonId },
          },
          select: {
            points: true,
            isFinal: true,
            scoreType: true,
            match: { select: { rawPayload: true, status: true } },
          },
        },
        knockoutScores: {
          where: {
            poolSeasonId: context.poolSeasonId,
            fixture: { seasonId: context.seasonId },
          },
          select: {
            points: true,
            isFinal: true,
            scoreType: true,
            fixture: { select: { stage: true, status: true } },
          },
        },
      },
    }),
    prisma.match.findMany({
      where: { seasonId: context.seasonId },
      select: { rawPayload: true, status: true },
    }),
    prisma.knockoutFixture.findMany({
      where: { seasonId: context.seasonId },
      select: { stage: true, status: true },
    }),
  ]);

  const groupScoreRows = users.flatMap((user) =>
    user.scores.map((score) => ({
      userId: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      points: score.points,
      isFinal: score.isFinal,
      scoreType: score.scoreType,
      match: score.match,
    })),
  );

  const knockoutScoreRows = users.flatMap((user) =>
    user.knockoutScores.map((score) => ({
      userId: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      points: score.points,
      isFinal: score.isFinal,
      scoreType: score.scoreType,
      fixture: score.fixture,
    })),
  );

  const groupScores = groupScoreRows.map(({ match: _match, ...score }) => score);
  const knockoutScores = knockoutScoreRows.map(({ fixture: _fixture, ...score }) => score);
  const allScores = [...groupScores, ...knockoutScores];

  const awards: RankingAward[] = [];
  const leader = overallRanking[0];
  awards.push({
    key: 'overall_champion',
    title: 'Campeao Geral',
    subtitle: 'Trofeu maximo do bolao',
    scope: 'OVERALL',
    tier: 'legendary',
    status: buildOverallAwardStatus(groupMatches, knockoutFixtures, allScores),
    icon: 'trophy',
    ...(leader
      ? {
          winner: {
            userId: leader.userId,
            nickname: leader.nickname,
            avatarUrl: leader.avatarUrl,
            points: leader.points,
            exactScores: leader.exactScores,
            resultHits: leader.resultHits,
            oneGoalHits: leader.oneGoalHits,
            misses: leader.misses,
          },
        }
      : {}),
  });

  for (const round of [1, 2, 3] as const) {
    const roundMatches = groupMatches.filter(
      (match) => groupRoundNumber(match.rawPayload) === round,
    );
    const roundScores = groupScoreRows
      .filter((score) => groupRoundNumber(score.match.rawPayload) === round)
      .map(({ match: _match, ...score }) => score);

    awards.push(
      makeAward({
        key: `group_round_${round}`,
        title: `Campeao da ${round}a rodada`,
        subtitle: `Maior pontuacao na rodada ${round} da fase de grupos`,
        scope: 'GROUP_ROUND',
        tier: 'standard',
        status: buildAwardStatus(roundMatches, roundScores),
        icon: round === 1 ? 'medal' : 'medal-outline',
        scores: roundScores,
      }),
    );
  }

  awards.push(
    makeAward({
      key: 'group_stage_king',
      title: 'Rei da Fase de Grupos',
      subtitle: 'Melhor pontuacao nos 72 jogos',
      scope: 'GROUP_STAGE',
      tier: 'major',
      status: buildAwardStatus(groupMatches, groupScores, EXPECTED_GROUP_MATCHES),
      icon: 'ribbon',
      scores: groupScores,
    }),
  );

  awards.push(
    makeAward({
      key: 'knockout_master',
      title: 'Mestre da Chave',
      subtitle: 'Maior pontuacao nas eliminatorias',
      scope: 'KNOCKOUT_BRACKET',
      tier: 'major',
      status: buildAwardStatus(knockoutFixtures, knockoutScores, EXPECTED_KNOCKOUT_FIXTURES),
      icon: 'git-network-outline',
      scores: knockoutScores,
    }),
  );

  const stageAwards: Array<{
    key: string;
    title: string;
    subtitle: string;
    stages: KnockoutStage[];
    tier: RankingAwardTier;
    icon: string;
    expectedItems: number;
  }> = [
    {
      key: 'round_of_32',
      title: 'Mata-mata inicial',
      subtitle: 'Campeao dos 16 avos',
      stages: ['ROUND_OF_32'],
      tier: 'standard',
      icon: 'shield-outline',
      expectedItems: EXPECTED_STAGE_FIXTURES.ROUND_OF_32,
    },
    {
      key: 'round_of_16',
      title: 'Campeao das Oitavas',
      subtitle: 'Maior pontuacao nas oitavas',
      stages: ['ROUND_OF_16'],
      tier: 'standard',
      icon: 'shield-outline',
      expectedItems: EXPECTED_STAGE_FIXTURES.ROUND_OF_16,
    },
    {
      key: 'quarter_final',
      title: 'Campeao das Quartas',
      subtitle: 'Maior pontuacao nas quartas',
      stages: ['QUARTER_FINAL'],
      tier: 'standard',
      icon: 'shield-outline',
      expectedItems: EXPECTED_STAGE_FIXTURES.QUARTER_FINAL,
    },
    {
      key: 'semi_final',
      title: 'Campeao da Semi',
      subtitle: 'Maior pontuacao na semifinal',
      stages: ['SEMI_FINAL'],
      tier: 'standard',
      icon: 'shield-outline',
      expectedItems: EXPECTED_STAGE_FIXTURES.SEMI_FINAL,
    },
    {
      key: 'finals_owner',
      title: 'Dono das Finais',
      subtitle: 'Final e disputa de 3o lugar',
      stages: ['THIRD_PLACE', 'FINAL'],
      tier: 'major',
      icon: 'star',
      expectedItems: EXPECTED_STAGE_FIXTURES.THIRD_PLACE + EXPECTED_STAGE_FIXTURES.FINAL,
    },
  ];

  for (const stageAward of stageAwards) {
    const stageSet = new Set<KnockoutStage>(stageAward.stages);
    const stageFixtures = knockoutFixtures.filter((fixture) => stageSet.has(fixture.stage));
    const stageScores = knockoutScoreRows
      .filter((score) => stageSet.has(score.fixture.stage))
      .map(({ fixture: _fixture, ...score }) => score);

    awards.push(
      makeAward({
        key: stageAward.key,
        title: stageAward.title,
        subtitle: stageAward.subtitle,
        scope: 'KNOCKOUT_STAGE',
        tier: stageAward.tier,
        status: buildAwardStatus(stageFixtures, stageScores, stageAward.expectedItems),
        icon: stageAward.icon,
        scores: stageScores,
      }),
    );
  }

  return awards;
}

export async function refreshRankingSnapshot(context: RankingContext = DEFAULT_RANKING_CONTEXT) {
  const ranking = await getRanking('all', context);
  const calculatedAt = new Date();
  const retentionCutoff = rankingSnapshotRetentionCutoff(calculatedAt);
  const result = await prisma.$transaction(async (tx) => {
    const [matchRevisions, knockoutRevisions] = await Promise.all([
      tx.predictionScore.findMany({ where: { poolSeasonId: context.poolSeasonId }, orderBy: { predictionId: 'asc' }, select: { predictionId: true, calculationKey: true } }),
      tx.knockoutPredictionScore.findMany({ where: { poolSeasonId: context.poolSeasonId }, orderBy: { pickId: 'asc' }, select: { pickId: true, calculationKey: true } }),
    ]);
    const sourceRevision = stableHash({ matchRevisions, knockoutRevisions });
    const snapshotKey = stableHash({ sourceRevision, ranking: ranking.map(({ lastFiveMatches: _matches, ...row }) => row) });
    await tx.rankingSnapshot.createMany({
      data: ranking.map((row) => ({
        userId: row.userId,
        seasonId: context.seasonId,
        poolSeasonId: context.poolSeasonId,
        points: row.points,
        finalPoints: row.finalPoints,
        exactScores: row.exactScores,
        resultHits: row.resultHits,
        oneGoalHits: row.oneGoalHits,
        misses: row.misses,
        rank: row.rank,
        hasLiveData: row.hasLiveData,
        snapshotKey,
        sourceRevision,
        calculatedAt,
      })),
      skipDuplicates: true,
    });
    const currentSnapshots = await tx.rankingSnapshot.findMany({
      where: { poolSeasonId: context.poolSeasonId, snapshotKey },
      select: { id: true, userId: true, rank: true, hasLiveData: true },
    });
    for (const current of currentSnapshots) {
      const previous = await tx.rankingSnapshot.findFirst({
        where: { poolSeasonId: context.poolSeasonId, userId: current.userId, snapshotKey: { not: snapshotKey } },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, rank: true, hasLiveData: true },
      });
      if (!previous) continue;
      const idempotencyKey = `movement:${context.poolSeasonId}:${current.userId}:${previous.id}:${current.id}`;
      const delta = previous.rank - current.rank;
      await tx.rankingMovement.createMany({
        data: [{ poolSeasonId: context.poolSeasonId, userId: current.userId, fromSnapshotId: previous.id, toSnapshotId: current.id, fromRank: previous.rank, toRank: current.rank, delta, isProvisional: previous.hasLiveData || current.hasLiveData, idempotencyKey }],
        skipDuplicates: true,
      });
      if (delta !== 0) {
        await tx.notificationInbox.createMany({
          data: [{
            poolSeasonId: context.poolSeasonId,
            userId: current.userId,
            type: 'RANKING_MOVEMENT',
            title: delta > 0 ? 'Você subiu no ranking' : 'Sua posição mudou',
            body: `${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'posição' : 'posições'} ${delta > 0 ? 'acima' : 'abaixo'} desde o snapshot anterior.`,
            data: { fromRank: previous.rank, toRank: current.rank, snapshotKey },
            isProvisional: previous.hasLiveData || current.hasLiveData,
            idempotencyKey: `notification:${idempotencyKey}`,
          }],
          skipDuplicates: true,
        });
      }
    }
    await tx.rankingSnapshot.deleteMany({
      where: {
        poolSeasonId: context.poolSeasonId,
        calculatedAt: { lt: retentionCutoff },
      },
    });
    const event = await enqueueOutboxEvent(tx, {
        type: 'ranking.updated',
        seasonId: context.seasonId,
        poolSeasonId: context.poolSeasonId,
        payload: { ranking, updatedAt: calculatedAt.toISOString() } as Prisma.InputJsonValue,
        idempotencyKey: `ranking.updated:${context.poolSeasonId}:${snapshotKey}`,
      });
    return { eventId: event.id, snapshotKey };
  });

  await dispatchOutboxEvent(result.eventId);
  return ranking;
}
