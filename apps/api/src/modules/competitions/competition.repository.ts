import { prisma } from '../../prisma.js';

const competitionSelect = {
  id: true,
  slug: true,
  name: true,
  capabilities: true,
} as const;

export async function listCompetitionRecords(pagination: { skip: number; take: number }) {
  return Promise.all([
    prisma.competition.findMany({
      orderBy: { name: 'asc' },
      ...pagination,
      select: competitionSelect,
    }),
    prisma.competition.count(),
  ]);
}

export async function findCompetitionBySlug(slug: string) {
  return prisma.competition.findUnique({ where: { slug }, select: competitionSelect });
}
