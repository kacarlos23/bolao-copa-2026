import type { ScoreType } from '@prisma/client';
import { calculatePredictionScore } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { emitSse } from '../realtime/sse.js';

export type RankingPeriod = 'all' | 'week' | 'day';

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

function buildRankingRows(
  users: Array<{
    id: string;
    nickname: string;
    avatarUrl: string | null;
    scores: Array<{ points: number; isFinal: boolean; scoreType: ScoreType; calculatedAt: Date }>;
    knockoutScores: Array<{
      points: number;
      isFinal: boolean;
      scoreType: ScoreType;
      calculatedAt: Date;
    }>;
  }>,
  period: RankingPeriod,
) {
  const rows = users
    .map((user) => {
      const scores = [...user.scores, ...user.knockoutScores].sort(
        (a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime(),
      );
      const points = scores.reduce((sum, score) => sum + score.points, 0);
      const finalPoints = scores
        .filter((score) => score.isFinal)
        .reduce((sum, score) => sum + score.points, 0);
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
        lastFive: scores
          .slice(0, 5)
          .reverse()
          .map((score) => score.points),
        hasLiveData: scores.some((score) => !score.isFinal),
      };
    })
    .filter((row) => period === 'all' || row.played > 0);

  return rows
    .sort(
      (a, b) =>
        b.points - a.points || b.exactScores - a.exactScores || a.nickname.localeCompare(b.nickname),
    )
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
        select: { points: true, isFinal: true, scoreType: true, calculatedAt: true },
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
        select: { points: true, isFinal: true, scoreType: true, calculatedAt: true },
      },
    },
  });

  return buildRankingRows(users, period);
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
