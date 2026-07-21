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
        poolMemberships: { some: { poolId: context.poolId, status: 'ACTIVE' } },
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
