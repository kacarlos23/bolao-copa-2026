import type { ScoreType } from '@prisma/client';
import { calculatePredictionScore } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { emitSse } from '../realtime/sse.js';

export async function recalculateScoresForMatch(matchId: string) {
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

  await refreshRankingSnapshot();
}

export async function getRanking() {
  const users = await prisma.user.findMany({
    where: { role: 'USER', status: 'ACTIVE' },
    select: {
      id: true,
      nickname: true,
      scores: {
        select: { points: true, isFinal: true, scoreType: true },
      },
    },
  });

  return users
    .map((user) => {
      const points = user.scores.reduce((sum, score) => sum + score.points, 0);
      const finalPoints = user.scores
        .filter((score) => score.isFinal)
        .reduce((sum, score) => sum + score.points, 0);
      return {
        userId: user.id,
        nickname: user.nickname,
        points,
        finalPoints,
        exactScores: user.scores.filter((score) => score.scoreType === 'EXACT_SCORE').length,
        resultHits: user.scores.filter((score) => score.scoreType === 'RESULT').length,
        oneGoalHits: user.scores.filter((score) => score.scoreType === 'ONE_TEAM_GOALS').length,
        hasLiveData: user.scores.some((score) => !score.isFinal),
      };
    })
    .sort((a, b) => b.points - a.points || b.exactScores - a.exactScores || a.nickname.localeCompare(b.nickname))
    .map((row, index) => ({ rank: index + 1, ...row }));
}

export async function refreshRankingSnapshot() {
  const ranking = await getRanking();
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
