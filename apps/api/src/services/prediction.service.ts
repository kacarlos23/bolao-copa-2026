import { Prisma } from '@prisma/client';
import type { UpsertMatchDayPredictionsInput } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { AppError } from '../http/errors.js';

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

  return days.map((day) => ({
    ...day,
    isOpenForPredictions: day.predictionsCloseAt > now,
    predictionsArePublic: day.predictionsCloseAt <= now,
  }));
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
            include: { user: { select: { id: true, nickname: true } } },
            orderBy: { user: { nickname: 'asc' } },
          },
        },
      },
    },
  });

  if (!day) throw new AppError(404, 'Dia de jogos nao encontrado.', 'MATCH_DAY_NOT_FOUND');

  const predictionsArePublic = day.predictionsCloseAt <= new Date();

  return {
    ...day,
    predictionsArePublic,
    matches: day.matches.map((match) => ({
      ...match,
      predictions: predictionsArePublic
        ? match.predictions
        : match.predictions.filter((prediction) => prediction.userId === viewerId),
    })),
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
    include: { matches: { select: { id: true } } },
  });

  if (!day) throw new AppError(404, 'Dia de jogos nao encontrado.', 'MATCH_DAY_NOT_FOUND');
  if (day.predictionsCloseAt <= new Date()) {
    throw new AppError(409, 'Palpites deste dia ja foram fechados.', 'PREDICTIONS_CLOSED');
  }

  const allowedMatchIds = new Set(day.matches.map((match) => match.id));
  for (const prediction of input.predictions) {
    if (!allowedMatchIds.has(prediction.matchId)) {
      throw new AppError(400, 'Palpite contem jogo fora do dia selecionado.', 'MATCH_DAY_MISMATCH');
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
