import { prisma } from '../../prisma.js';

export function listSeasonStageRecords(seasonId: string) {
  return prisma.stage.findMany({
    where: { seasonId },
    orderBy: { order: 'asc' },
    select: { id: true, seasonId: true, slug: true, name: true, type: true, order: true },
  });
}

export function findStageInSeason(stageId: string, seasonId: string) {
  return prisma.stage.findFirst({
    where: { id: stageId, seasonId },
    select: { id: true },
  });
}
