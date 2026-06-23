import type { KnockoutStage, Prisma, ScoreType } from '@prisma/client';
import { calculatePredictionScore } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { emitSse } from '../realtime/sse.js';

export type RankingPeriod = 'all' | 'week' | 'day';

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
  return (
    b.points - a.points ||
    b.exactScores - a.exactScores ||
    b.resultHits - a.resultHits ||
    b.oneGoalHits - a.oneGoalHits ||
    a.misses - b.misses ||
    a.nickname.localeCompare(b.nickname, 'pt-BR')
  );
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
  options: { refreshRanking?: boolean } = {},
) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { predictions: true },
  });

  if (!match) return;

  const actualHomeScore = match.status === 'FINISHED' ? match.finalHomeScore : match.homeScore;
  const actualAwayScore = match.status === 'FINISHED' ? match.finalAwayScore : match.awayScore;

  if (actualHomeScore == null || actualAwayScore == null) return;

  for (const prediction of match.predictions) {
    const score = calculatePredictionScore({
      predictedHomeScore: prediction.predictedHomeScore,
      predictedAwayScore: prediction.predictedAwayScore,
      actualHomeScore,
      actualAwayScore,
    });

    await prisma.predictionScore.upsert({
      where: { predictionId: prediction.id },
      update: {
        points: score.points,
        scoreType: score.scoreType as ScoreType,
        isFinal: match.status === 'FINISHED',
        calculatedAt: new Date(),
      },
      create: {
        predictionId: prediction.id,
        matchId: match.id,
        userId: prediction.userId,
        points: score.points,
        scoreType: score.scoreType as ScoreType,
        isFinal: match.status === 'FINISHED',
      },
    });
  }

  if (options.refreshRanking !== false) await refreshRankingSnapshot();
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

function addCivilDays(
  value: { year: number; month: number; day: number },
  amount: number,
) {
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
        homeTeam: { id: string; name: string; code?: string | null; metadata?: any } | null;
        awayTeam: { id: string; name: string; code?: string | null; metadata?: any } | null;
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
        homeTeam: { id: string; name: string; code?: string | null; metadata?: any } | null;
        awayTeam: { id: string; name: string; code?: string | null; metadata?: any } | null;
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
      const scores = [...(user.scores as any[]), ...(user.knockoutScores as any[])].sort(
        (a: any, b: any) => b.calculatedAt.getTime() - a.calculatedAt.getTime(),
      );
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
          match: score.match || score.fixture,
        })),
        hasLiveData: scores.some((score) => !score.isFinal),
      };
    })
    .filter((row) => period === 'all' || row.played > 0);

  return rows
    .sort(compareRankingRows)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

export async function getRanking(period: RankingPeriod = 'all') {
  const window = rankingWindow(period);
  const users = await prisma.user.findMany({
    where: { role: 'USER', status: 'ACTIVE' },
    select: {
      id: true,
      nickname: true,
      avatarUrl: true,
      scores: {
        ...(window
          ? {
              where: {
                match: {
                  startsAt: {
                    gte: window.start,
                    lt: window.end,
                  },
                },
              },
            }
          : {}),
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
        ...(window
          ? {
              where: {
                fixture: {
                  startsAt: {
                    gte: window.start,
                    lt: window.end,
                  },
                },
              },
            }
          : {}),
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

export async function getRankingAwards() {
  const [overallRanking, users, groupMatches, knockoutFixtures] = await Promise.all([
    getRanking('all'),
    prisma.user.findMany({
      where: { role: 'USER', status: 'ACTIVE' },
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        scores: {
          select: {
            points: true,
            isFinal: true,
            scoreType: true,
            match: { select: { rawPayload: true, status: true } },
          },
        },
        knockoutScores: {
          select: {
            points: true,
            isFinal: true,
            scoreType: true,
            fixture: { select: { stage: true, status: true } },
          },
        },
      },
    }),
    prisma.match.findMany({ select: { rawPayload: true, status: true } }),
    prisma.knockoutFixture.findMany({ select: { stage: true, status: true } }),
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
    const roundMatches = groupMatches.filter((match) => groupRoundNumber(match.rawPayload) === round);
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
      subtitle: 'Campeao dos 32 avos',
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

export async function refreshRankingSnapshot() {
  const ranking = await getRanking('all');
  await prisma.rankingSnapshot.createMany({
    data: ranking.map((row) => ({
      userId: row.userId,
      points: row.points,
      finalPoints: row.finalPoints,
      exactScores: row.exactScores,
      resultHits: row.resultHits,
      oneGoalHits: row.oneGoalHits,
      rank: row.rank,
      hasLiveData: row.hasLiveData,
    })),
  });

  emitSse('ranking.updated', { ranking, updatedAt: new Date().toISOString() });
  return ranking;
}
