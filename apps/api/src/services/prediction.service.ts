import { Prisma } from '@prisma/client';
import type { UpsertMatchDayPredictionsInput } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { AppError } from '../http/errors.js';

const MATCH_PREDICTION_CLOSE_MINUTES = 5;

function matchPredictionsCloseAt(startsAt: Date) {
  return new Date(startsAt.getTime() - MATCH_PREDICTION_CLOSE_MINUTES * 60 * 1000);
}

function matchPredictionState(startsAt: Date, now = new Date()) {
  const predictionsCloseAt = matchPredictionsCloseAt(startsAt);
  const predictionsArePublic = predictionsCloseAt <= now;
  return {
    predictionsCloseAt,
    isOpenForPredictions: !predictionsArePublic,
    predictionsArePublic,
  };
}

export async function listMatchDays(userId?: string) {
  const now = new Date();
  const days = await prisma.matchDay.findMany({
    orderBy: { firstMatchStartsAt: 'asc' },
    include: {
      matches: {
        orderBy: { startsAt: 'asc' },
        include: {
          homeTeam: true,
          awayTeam: true,
          predictions: userId ? { where: { userId } } : false,
        },
      },
    },
  });

  return days.map((day) => {
    const matches = day.matches.map((match) => ({
      ...match,
      ...matchPredictionState(match.startsAt, now),
    }));

    return {
      ...day,
      matches,
      isOpenForPredictions: matches.some((match) => match.isOpenForPredictions),
      predictionsArePublic: matches.every((match) => match.predictionsArePublic),
    };
  });
}

export async function getMatchDay(matchDayId: string, viewerId: string) {
  const day = await prisma.matchDay.findUnique({
    where: { id: matchDayId },
    include: {
      matches: {
        orderBy: { startsAt: 'asc' },
        include: {
          homeTeam: true,
          awayTeam: true,
          predictions: {
            where: { user: { role: 'USER', status: 'ACTIVE' } },
            include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
            orderBy: { user: { nickname: 'asc' } },
          },
        },
      },
    },
  });

  if (!day) throw new AppError(404, 'Dia de jogos nao encontrado.', 'MATCH_DAY_NOT_FOUND');

  const now = new Date();
  const matches = day.matches.map((match) => {
    const predictionState = matchPredictionState(match.startsAt, now);
    return {
      ...match,
      ...predictionState,
      predictions: predictionState.predictionsArePublic
        ? match.predictions
        : match.predictions.filter((prediction) => prediction.userId === viewerId),
    };
  });

  return {
    ...day,
    predictionsArePublic: matches.every((match) => match.predictionsArePublic),
    isOpenForPredictions: matches.some((match) => match.isOpenForPredictions),
    matches,
  };
}

export async function upsertPredictions(
  matchDayId: string,
  userId: string,
  input: UpsertMatchDayPredictionsInput,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });

  if (!user || user.status !== 'ACTIVE') {
    throw new AppError(403, 'Usuario sem permissao para salvar palpites.', 'USER_NOT_ALLOWED');
  }

  if (user.role === 'ADMIN') {
    throw new AppError(403, 'Administrador nao participa dos palpites.', 'ADMIN_NOT_ALLOWED');
  }

  const day = await prisma.matchDay.findUnique({
    where: { id: matchDayId },
    include: { matches: { select: { id: true, startsAt: true } } },
  });

  if (!day) throw new AppError(404, 'Dia de jogos nao encontrado.', 'MATCH_DAY_NOT_FOUND');

  const now = new Date();
  const matchesById = new Map(day.matches.map((match) => [match.id, match]));
  for (const prediction of input.predictions) {
    const match = matchesById.get(prediction.matchId);
    if (!match) {
      throw new AppError(400, 'Palpite contem jogo fora do dia selecionado.', 'MATCH_DAY_MISMATCH');
    }
    if (matchPredictionsCloseAt(match.startsAt) <= now) {
      throw new AppError(409, 'Palpite deste jogo ja foi fechado.', 'PREDICTION_CLOSED_FOR_MATCH');
    }
  }

  return prisma.$transaction(
    input.predictions.map((prediction) =>
      prisma.prediction.upsert({
        where: { userId_matchId: { userId, matchId: prediction.matchId } },
        update: {
          predictedHomeScore: prediction.predictedHomeScore,
          predictedAwayScore: prediction.predictedAwayScore,
        },
        create: {
          userId,
          matchId: prediction.matchId,
          predictedHomeScore: prediction.predictedHomeScore,
          predictedAwayScore: prediction.predictedAwayScore,
        },
      }),
    ),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
