import { prisma } from '../../prisma.js';

export function listPredictionRecords(
  context: { poolSeasonId: string; seasonId: string },
  userId: string,
  pagination: { skip: number; take: number },
  matchDayId?: string,
) {
  const where = {
    poolSeasonId: context.poolSeasonId,
    userId,
    match: {
      seasonId: context.seasonId,
      ...(matchDayId ? { matchDayId } : {}),
    },
  } as const;
  return Promise.all([
    prisma.prediction.findMany({
      where,
      orderBy: [{ match: { startsAt: 'asc' } }, { id: 'asc' }],
      ...pagination,
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
    prisma.prediction.count({ where }),
  ]);
}

export function findMatchForPublicPredictions(seasonId: string, matchId: string) {
  return prisma.match.findFirst({
    where: { id: matchId, seasonId },
    select: {
      id: true,
      startsAt: true,
      predictionClosesAt: true,
      status: true,
      homeScore: true,
      awayScore: true,
      finalHomeScore: true,
      finalAwayScore: true,
      tieId: true,
      regulationHomeScore: true,
      regulationAwayScore: true,
    },
  });
}

export function listPublicMatchPredictionRecords(
  context: { poolSeasonId: string; poolId: string },
  matchId: string,
) {
  return prisma.prediction.findMany({
    where: {
      poolSeasonId: context.poolSeasonId,
      matchId,
      user: {
        role: { in: ['USER', 'ADMIN'] },
        status: 'ACTIVE',
        poolSeasonMemberships: { some: { poolSeasonId: context.poolSeasonId, status: 'ACTIVE' } },
      },
    },
    orderBy: [{ user: { nickname: 'asc' } }, { id: 'asc' }],
    select: {
      id: true,
      userId: true,
      matchId: true,
      predictedHomeScore: true,
      predictedAwayScore: true,
      user: { select: { id: true, nickname: true, avatarUrl: true } },
    },
  });
}

export function listMatchesForPredictionSubmissionStatus(seasonId: string, matchIds: string[]) {
  return prisma.match.findMany({
    where: { id: { in: matchIds }, seasonId },
    select: {
      id: true,
      startsAt: true,
      predictionClosesAt: true,
      status: true,
      round: { select: { order: true } },
    },
  });
}

export function listPredictionSubmissionParticipantRecords(
  context: { poolSeasonId: string },
  matchIds: string[],
) {
  return prisma.poolSeasonMembership.findMany({
    where: {
      poolSeasonId: context.poolSeasonId,
      status: 'ACTIVE',
      user: {
        role: { in: ['USER', 'ADMIN'] },
        status: 'ACTIVE',
      },
    },
    orderBy: { user: { nickname: 'asc' } },
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          nickname: true,
          avatarUrl: true,
          predictions: {
            where: {
              poolSeasonId: context.poolSeasonId,
              matchId: { in: matchIds },
            },
            select: { matchId: true },
          },
        },
      },
    },
  });
}
