import { Prisma } from '@prisma/client';
import {
  predictionDtoSchema,
  type PaginationQuery,
  type UpsertSeasonPredictionsInput,
} from '@bolao/shared';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import { resolvePoolSeasonContext, type PoolSeasonContext } from '../pools/pool-context.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import {
  DEFAULT_PREDICTION_CLOSE_MINUTES,
  MAX_PREDICTION_CLOSE_MINUTES,
  MIN_PREDICTION_CLOSE_MINUTES,
  PREDICTION_CLOSE_MINUTES_KEY,
} from '../../services/prediction-settings.service.js';
import { listPredictionRecords } from './prediction.repository.js';
import { competitionFeatureFlagsSchema } from '../competitions/competition-feature.service.js';
import { isPoolMatchScoreable } from './scoreability.js';

function toPredictionDto(prediction: {
  id: string;
  poolSeasonId: string | null;
  userId: string;
  matchId: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  updatedAt: Date;
}) {
  if (!prediction.poolSeasonId) {
    throw new AppError(500, 'Palpite sem contexto.', 'PREDICTION_CONTEXT_MISSING');
  }
  return predictionDtoSchema.parse({
    ...prediction,
    poolSeasonId: prediction.poolSeasonId,
    updatedAt: prediction.updatedAt.toISOString(),
  });
}

export async function listPredictions(
  context: PoolSeasonContext,
  userId: string,
  query: PaginationQuery & { matchDayId?: string },
) {
  const [predictions, total] = await listPredictionRecords(
    context,
    userId,
    paginationArgs(query),
    query.matchDayId,
  );
  return {
    predictions: predictions.map(toPredictionDto),
    pagination: paginationMeta(query, total),
  };
}

function closeMinutes(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_PREDICTION_CLOSE_MINUTES;
  }
  const minutes = value.minutes;
  return typeof minutes === 'number' &&
    Number.isInteger(minutes) &&
    minutes >= MIN_PREDICTION_CLOSE_MINUTES &&
    minutes <= MAX_PREDICTION_CLOSE_MINUTES
    ? minutes
    : DEFAULT_PREDICTION_CLOSE_MINUTES;
}

export async function savePredictions(input: {
  poolSlug: string;
  seasonId: string;
  userId: string;
  body: UpsertSeasonPredictionsInput;
}) {
  const result = await prisma.$transaction(
    async (tx) => {
      const context = await resolvePoolSeasonContext(input, tx);
      const [matchDay, setting, featureSetting] = await Promise.all([
        tx.matchDay.findFirst({
          where: { id: input.body.matchDayId, seasonId: context.seasonId },
          select: { id: true },
        }),
        tx.appSetting.findUnique({
          where: { key: PREDICTION_CLOSE_MINUTES_KEY },
          select: { value: true },
        }),
        tx.appSetting.findUnique({
          where: { key: `competition-features:${context.seasonId}` },
          select: { key: true, value: true },
        }),
      ]);
      if (
        context.systemRole !== 'ADMIN' &&
        featureSetting?.key === `competition-features:${context.seasonId}` &&
        !competitionFeatureFlagsSchema.parse(featureSetting.value).writeEnabled
      ) {
        throw new AppError(
          404,
          'Temporada indisponível durante o canário administrativo.',
          'COMPETITION_FEATURE_DISABLED',
        );
      }
      if (!matchDay) {
        throw new AppError(404, 'Dia de jogos não pertence à temporada.', 'MATCH_DAY_SEASON_MISMATCH');
      }

      const matchIds = input.body.predictions.map((prediction) => prediction.matchId);
      const matches = await tx.match.findMany({
        where: {
          id: { in: matchIds },
          matchDayId: matchDay.id,
          seasonId: context.seasonId,
        },
        select: {
          id: true,
          startsAt: true,
          predictionClosesAt: true,
          seasonId: true,
          status: true,
          round: { select: { order: true } },
        },
      });
      if (matches.length !== matchIds.length || matches.some((match) => match.seasonId !== context.seasonId)) {
        throw new AppError(
          400,
          'Palpite contém partida fora da temporada ou do dia selecionado.',
          'MATCH_SEASON_MISMATCH',
        );
      }

      const now = new Date();
      const minutes = closeMinutes(setting?.value);
      for (const match of matches) {
        if (
          !isPoolMatchScoreable(context, {
            roundOrder: match.round?.order ?? null,
            startsAt: match.startsAt,
          })
        ) {
          throw new AppError(
            409,
            'Partidas históricas não aceitam palpites nem pontuam neste bolão.',
            'PREDICTION_MATCH_NOT_SCOREABLE',
          );
        }
        if (match.status && match.status !== 'SCHEDULED') {
          throw new AppError(
            409,
            match.status === 'POSTPONED'
              ? 'Partida adiada: o palpite existente foi preservado e reabrirá após remarcação.'
              : 'A partida não está aberta para novos palpites.',
            'PREDICTION_MATCH_UNAVAILABLE',
          );
        }
        const closesAt =
          match.predictionClosesAt ?? new Date(match.startsAt.getTime() - minutes * 60_000);
        if (now >= closesAt) {
          throw new AppError(
            409,
            'Os palpites desta partida já foram fechados.',
            'PREDICTION_MATCH_CLOSED',
          );
        }
      }

      const saved = [];
      for (const prediction of input.body.predictions) {
        saved.push(
          await tx.prediction.upsert({
            where: {
              poolSeasonId_userId_matchId: {
                poolSeasonId: context.poolSeasonId,
                userId: input.userId,
                matchId: prediction.matchId,
              },
            },
            update: {
              predictedHomeScore: prediction.predictedHomeScore,
              predictedAwayScore: prediction.predictedAwayScore,
            },
            create: {
              poolSeasonId: context.poolSeasonId,
              userId: input.userId,
              matchId: prediction.matchId,
              predictedHomeScore: prediction.predictedHomeScore,
              predictedAwayScore: prediction.predictedAwayScore,
            },
            select: {
              id: true,
              poolSeasonId: true,
              userId: true,
              matchId: true,
              predictedHomeScore: true,
              predictedAwayScore: true,
              updatedAt: true,
            },
          }),
        );
      }

      const event = await enqueueOutboxEvent(tx, {
        type: 'prediction.updated',
        seasonId: context.seasonId,
        poolSeasonId: context.poolSeasonId,
        payload: { userId: input.userId, matchIds },
      });
      return { context, saved, eventId: event.id };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  await dispatchOutboxEvent(result.eventId);
  return { predictions: result.saved.map(toPredictionDto), context: result.context };
}
