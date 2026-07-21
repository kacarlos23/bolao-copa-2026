import type { UpsertMatchDayPredictionsInput } from '@bolao/shared';
import { prisma } from '../prisma.js';
import { serializableTransaction } from '../prisma-transaction.js';
import { AppError } from '../http/errors.js';
import { emitSse } from '../realtime/sse.js';
import {
  DEFAULT_PREDICTION_CLOSE_MINUTES,
  getPredictionCloseMinutes,
  predictionCloseAt,
  predictionState,
} from './prediction-settings.service.js';
import { WORLD_CUP_CONTEXT } from '../domain/world-cup-context.js';
import type { PoolSeasonContext } from '../modules/pools/pool-context.js';

function knockoutStageLabel(stage: string) {
  const labels: Record<string, string> = {
    ROUND_OF_32: '16 avos',
    ROUND_OF_16: 'Oitavas de final',
    QUARTER_FINAL: 'Quartas de final',
    SEMI_FINAL: 'Semifinais',
    THIRD_PLACE: 'Disputa de terceiro lugar',
    FINAL: 'Final',
  };
  return labels[stage] ?? stage;
}

function sourceLabel(source: string) {
  if (/^[12][A-L]$/.test(source)) return `${source[0]}o do Grupo ${source[1]}`;
  if (source === '3*') return 'Melhor 3o colocado';
  if (/^W\d+$/.test(source)) return `Vencedor Jogo ${source.slice(1)}`;
  if (/^L\d+$/.test(source)) return `Perdedor Jogo ${source.slice(1)}`;
  return 'A definir';
}

function placeholderTeam(source: string) {
  return {
    id: `placeholder-${source}`,
    name: sourceLabel(source),
    code: 'TBD',
    externalId: null,
    flagUrl: null,
    metadata: null,
    fifaRank: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function saoPauloDateOnly(value: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(value);
}

type MatchDayMatchView = {
  startsAt: Date;
  isOpenForPredictions: boolean;
  predictionsArePublic: boolean;
  [key: string]: unknown;
};

type MatchDayView = {
  id: string;
  date: Date | string;
  firstMatchStartsAt: Date;
  predictionsCloseAt: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  matches: MatchDayMatchView[];
  isOpenForPredictions: boolean;
  predictionsArePublic: boolean;
  [key: string]: unknown;
};

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

export async function listMatchDays(
  userId?: string,
  context: Pick<PoolSeasonContext, 'seasonId' | 'poolSeasonId'> = WORLD_CUP_CONTEXT,
) {
  const now = new Date();
  const [predictionCloseMinutes, days, knockoutFixtures] = await Promise.all([
    getPredictionCloseMinutes(),
    prisma.matchDay.findMany({
      where: { seasonId: context.seasonId },
      orderBy: { firstMatchStartsAt: 'asc' },
      include: {
        matches: {
          orderBy: { startsAt: 'asc' },
          include: {
            homeTeam: true,
            awayTeam: true,
            predictions: userId ? { where: { userId, poolSeasonId: context.poolSeasonId } } : false,
          },
        },
      },
    }),
    prisma.knockoutFixture.findMany({
      where: { seasonId: context.seasonId },
      orderBy: { startsAt: 'asc' },
      include: { homeTeam: true, awayTeam: true, winnerTeam: true },
    }),
  ]);

  const matchDaysByDate = new Map<string, MatchDayView>();

  for (const day of days) {
    const matches: MatchDayMatchView[] = day.matches.map((match) => ({
      ...match,
      ...matchPredictionState(match.startsAt, now, predictionCloseMinutes),
    }));

    matchDaysByDate.set(saoPauloDateOnly(day.date), {
      ...day,
      matches,
      isOpenForPredictions: matches.some((match) => match.isOpenForPredictions),
      predictionsArePublic: matches.every((match) => match.predictionsArePublic),
    });
  }

  for (const fixture of knockoutFixtures) {
    const date = saoPauloDateOnly(fixture.startsAt);
    const current = matchDaysByDate.get(date);
    const state = matchPredictionState(fixture.startsAt, now, predictionCloseMinutes);
    const match: MatchDayMatchView = {
      id: `knockout-${fixture.id}`,
      matchDayId: current?.id ?? `knockout-day-${date}`,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      startsAt: fixture.startsAt,
      status: fixture.status,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      finalHomeScore: fixture.finalHomeScore,
      finalAwayScore: fixture.finalAwayScore,
      homeTeam: fixture.homeTeam ?? placeholderTeam(fixture.homeSource),
      awayTeam: fixture.awayTeam ?? placeholderTeam(fixture.awaySource),
      predictions: [],
      rawPayload: {
        round: `${knockoutStageLabel(fixture.stage)} - Jogo ${fixture.matchNumber}`,
        group: 'Mata-mata',
        type: 'KNOCKOUT',
        knockoutFixtureId: fixture.id,
        knockoutMatchNumber: fixture.matchNumber,
        knockoutStage: fixture.stage,
      },
      ...state,
    };

    if (current) {
      current.matches.push(match);
      current.matches.sort(
        (matchA, matchB) => matchA.startsAt.getTime() - matchB.startsAt.getTime(),
      );
      current.firstMatchStartsAt = current.matches[0]?.startsAt ?? current.firstMatchStartsAt;
      current.predictionsCloseAt = predictionCloseAt(
        current.firstMatchStartsAt,
        predictionCloseMinutes,
      );
      current.isOpenForPredictions = current.matches.some((item) => item.isOpenForPredictions);
      current.predictionsArePublic = current.matches.every((item) => item.predictionsArePublic);
      continue;
    }

    matchDaysByDate.set(date, {
      id: `knockout-day-${date}`,
      date,
      firstMatchStartsAt: fixture.startsAt,
      predictionsCloseAt: predictionCloseAt(fixture.startsAt, predictionCloseMinutes),
      status: state.isOpenForPredictions ? 'OPEN' : 'CLOSED',
      createdAt: fixture.createdAt,
      updatedAt: fixture.updatedAt,
      matches: [match],
      isOpenForPredictions: state.isOpenForPredictions,
      predictionsArePublic: state.predictionsArePublic,
    });
  }

  const matchDays = [...matchDaysByDate.values()].sort(
    (dayA, dayB) =>
      new Date(dayA.firstMatchStartsAt).getTime() - new Date(dayB.firstMatchStartsAt).getTime(),
  );
  return { matchDays, predictionCloseMinutes };
}

export async function getMatchDay(
  matchDayId: string,
  viewerId: string,
  context: Pick<PoolSeasonContext, 'seasonId' | 'poolSeasonId' | 'poolId'> = WORLD_CUP_CONTEXT,
) {
  const [predictionCloseMinutes, day] = await Promise.all([
    getPredictionCloseMinutes(),
    prisma.matchDay.findFirst({
      where: { id: matchDayId, seasonId: context.seasonId },
      include: {
        matches: {
          orderBy: { startsAt: 'asc' },
          include: {
            homeTeam: true,
            awayTeam: true,
            predictions: {
              where: {
                poolSeasonId: context.poolSeasonId,
                user: {
                  role: { in: ['USER', 'ADMIN'] },
                  status: 'ACTIVE',
                  poolMemberships: { some: { poolId: context.poolId, status: 'ACTIVE' } },
                },
              },
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
  const predictionCloseMinutes = await getPredictionCloseMinutes();
  const saved = await serializableTransaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError(403, 'Usuário sem permissão para salvar palpites.', 'USER_NOT_ALLOWED');
    }

    const day = await tx.matchDay.findUnique({
      where: { id: matchDayId },
      include: {
        matches: { select: { id: true, startsAt: true, predictionClosesAt: true } },
      },
    });
    if (!day) throw new AppError(404, 'Dia de jogos não encontrado.', 'MATCH_DAY_NOT_FOUND');

    const matchesById = new Map(day.matches.map((match) => [match.id, match]));
    const now = new Date();
    for (const prediction of input.predictions) {
      const match = matchesById.get(prediction.matchId);
      if (!match) {
        throw new AppError(
          400,
          'Palpite contém jogo fora do dia selecionado.',
          'MATCH_DAY_MISMATCH',
        );
      }
      const closesAt =
        match.predictionClosesAt ?? matchPredictionsCloseAt(match.startsAt, predictionCloseMinutes);
      if (now >= closesAt) {
        throw new AppError(
          409,
          'Os palpites desta partida já foram fechados.',
          'PREDICTION_MATCH_CLOSED',
        );
      }
    }

    const predictions = [];
    for (const prediction of input.predictions) {
      predictions.push(
        await tx.prediction.upsert({
          where: { userId_matchId: { userId, matchId: prediction.matchId } },
          update: {
            poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
            predictedHomeScore: prediction.predictedHomeScore,
            predictedAwayScore: prediction.predictedAwayScore,
          },
          create: {
            userId,
            matchId: prediction.matchId,
            poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId,
            predictedHomeScore: prediction.predictedHomeScore,
            predictedAwayScore: prediction.predictedAwayScore,
          },
        }),
      );
    }
    return predictions;
  });

  emitSse('prediction-board.updated', {
    userId,
    matchIds: saved.map((prediction) => prediction.matchId),
    updatedAt: new Date().toISOString(),
  });
  return saved;
}
