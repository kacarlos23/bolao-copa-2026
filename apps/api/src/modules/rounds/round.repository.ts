import { prisma } from '../../prisma.js';

export function listSeasonRoundRecords(
  seasonId: string,
  pagination: { skip: number; take: number },
) {
  const where = { seasonId } as const;
  return Promise.all([
    prisma.round.findMany({
      where,
      orderBy: [{ stage: { order: 'asc' } }, { order: 'asc' }],
      ...pagination,
      select: {
        id: true,
        seasonId: true,
        stageId: true,
        name: true,
        order: true,
        status: true,
        startsAt: true,
        endsAt: true,
        stage: { select: { id: true, name: true, type: true } },
      },
    }),
    prisma.round.count({ where }),
  ]);
}

export function findRoundInSeason(roundId: string, seasonId: string) {
  return prisma.round.findFirst({
    where: { id: roundId, seasonId },
    select: { id: true },
  });
}
