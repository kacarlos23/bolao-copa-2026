import { prisma } from '../../prisma.js';

export const teamSummarySelect = {
  id: true,
  name: true,
  code: true,
  flagUrl: true,
  crestUrl: true,
} as const;

export async function listSeasonTeamProfiles(
  seasonId: string,
  pagination: { skip: number; take: number },
) {
  const [entries, total, mappings] = await Promise.all([
    prisma.seasonTeam.findMany({
      where: { seasonId },
      orderBy: { team: { name: 'asc' } },
      ...pagination,
      select: {
        team: {
          select: {
            ...teamSummarySelect,
            profileSnapshots: {
              where: { seasonId, provider: 'cbf-official' },
              orderBy: { collectedAt: 'desc' },
              take: 1,
              select: { externalTeamId: true, state: true, collectedAt: true },
            },
          },
        },
      },
    }),
    prisma.seasonTeam.count({ where: { seasonId } }),
    prisma.providerEntityMapping.findMany({
      where: { seasonId, provider: 'cbf-official', entityType: 'TEAM' },
      select: { internalId: true, externalId: true },
    }),
  ]);
  return { entries, total, mappings };
}

export function findSeasonTeamProfile(seasonId: string, teamId: string) {
  return prisma.seasonTeam.findUnique({
    where: { seasonId_teamId: { seasonId, teamId } },
    select: {
      team: {
        select: {
          ...teamSummarySelect,
          profileSnapshots: {
            where: { seasonId, provider: 'cbf-official' },
            orderBy: { collectedAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
}
