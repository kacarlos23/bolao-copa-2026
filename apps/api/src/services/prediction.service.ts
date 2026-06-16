import { Prisma } from '@prisma/client';
import type { UpsertMatchDayPredictionsInput } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { AppError } from '../http/errors.js';
import { emitSse } from '../realtime/sse.js';
import {
  DEFAULT_PREDICTION_CLOSE_MINUTES,
  getPredictionCloseMinutes,
  predictionCloseAt,
  predictionState,
} from './prediction-settings.service.js';

export function matchPredictionsCloseAt(
  startsAt: Date,
  closeMinutes = DEFAULT_PREDICTION_CLOSE_MINUTES,
) {
  return predictionCloseAt(startsAt, closeMinutes);
}

export function matchPredictionState(
  startsAt: Date,
  now = new Date(),
  closeMinutes = DEFAULT_PREDICTION_CLOSE_MINUTES,
) {
  return predictionState(startsAt, closeMinutes, now);
}

export async function listMatchDays(userId?: string) {
  const now = new Date();
  const [predictionCloseMinutes, days] = await Promise.all([
    getPredictionCloseMinutes(),
    prisma.matchDay.findMany({
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
    }),
  ]);

  const matchDays = days.map((day) => {
    const matches = day.matches.map((match) => ({
      ...match,
      ...matchPredictionState(match.startsAt, now, predictionCloseMinutes),
    }));

    return {
      ...day,
      matches,
      isOpenForPredictions: matches.some((match) => match.isOpenForPredictions),
      predictionsArePublic: matches.every((match) => match.predictionsArePublic),
    };
  });
  return { matchDays, predictionCloseMinutes };
}

export async function getMatchDay(matchDayId: string, viewerId: string) {
  const [predictionCloseMinutes, day] = await Promise.all([
    getPredictionCloseMinutes(),
    prisma.matchDay.findUnique({
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
    }),
  ]);

  if (!day) throw new AppError(404, 'Dia de jogos não encontrado.', 'MATCH_DAY_NOT_FOUND');

  const now = new Date();
  const matches = day.matches.map((match) => {
    const currentState = matchPredictionState(match.startsAt, now, predictionCloseMinutes);
    return {
      ...match,
      ...currentState,
      predictions: currentState.predictionsArePublic
        ? match.predictions
        : match.predictions.filter((prediction) => prediction.userId === viewerId),
    };
  });

  return {
    matchDay: {
      ...day,
      isOpenForPredictions: matches.some((match) => match.isOpenForPredictions),
      predictionsArePublic: matches.every((match) => match.predictionsArePublic),
      matches,
    },
    predictionCloseMinutes,
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
    throw new AppError(403, 'Usuário sem permissão para salvar palpites.', 'USER_NOT_ALLOWED');
  }

  if (user.role === 'ADMIN') {
    throw new AppError(403, 'Administrador não participa dos palpites.', 'ADMIN_NOT_ALLOWED');
  }

  const [predictionCloseMinutes, day] = await Promise.all([
    getPredictionCloseMinutes(),
    prisma.matchDay.findUnique({
      where: { id: matchDayId },
      include: { matches: { select: { id: true, startsAt: true } } },
    }),
  ]);

  if (!day) throw new AppError(404, 'Dia de jogos não encontrado.', 'MATCH_DAY_NOT_FOUND');

  const matchesById = new Map(day.matches.map((match) => [match.id, match]));
  const now = new Date();
  for (const prediction of input.predictions) {
    const match = matchesById.get(prediction.matchId);
    if (!match) {
      throw new AppError(400, 'Palpite contem jogo fora do dia selecionado.', 'MATCH_DAY_MISMATCH');
    }
    if (!matchPredictionState(match.startsAt, now, predictionCloseMinutes).isOpenForPredictions) {
      throw new AppError(
        409,
        'Os palpites desta partida já foram fechados.',
        'PREDICTION_MATCH_CLOSED',
      );
    }
  }

  const saved = await prisma.$transaction(
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

  emitSse('prediction-board.updated', {
    userId,
    matchIds: saved.map((prediction) => prediction.matchId),
    updatedAt: new Date().toISOString(),
  });
  return saved;
}
