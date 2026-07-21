import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';

export const seasonSelect = {
  id: true,
  competitionId: true,
  slug: true,
  name: true,
  year: true,
  timezone: true,
  status: true,
  startsAt: true,
  endsAt: true,
  capabilities: true,
  metadata: true,
} satisfies Prisma.CompetitionSeasonSelect;

export async function findSeasonById(seasonId: string) {
  return prisma.competitionSeason.findUnique({ where: { id: seasonId }, select: seasonSelect });
}

export async function listCompetitionSeasons(
  competitionId: string,
  pagination: { skip: number; take: number },
) {
  return Promise.all([
    prisma.competitionSeason.findMany({
      where: { competitionId },
      orderBy: [{ year: 'desc' }, { startsAt: 'desc' }, { name: 'asc' }],
      ...pagination,
      select: seasonSelect,
    }),
    prisma.competitionSeason.count({ where: { competitionId } }),
  ]);
}
