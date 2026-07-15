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
