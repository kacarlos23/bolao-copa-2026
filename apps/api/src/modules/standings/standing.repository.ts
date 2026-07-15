import { prisma } from '../../prisma.js';

const teamSelect = {
  id: true,
  name: true,
  code: true,
  flagUrl: true,
  crestUrl: true,
} as const;

export async function loadSeasonStandingsData(seasonId: string) {
  return Promise.all([
    prisma.seasonTeam.findMany({
      where: { seasonId },
      orderBy: [{ groupName: 'asc' }, { team: { name: 'asc' } }],
      select: { groupName: true, team: { select: teamSelect } },
    }),
    prisma.match.findMany({
      where: { seasonId },
      orderBy: { startsAt: 'asc' },
      select: {
        status: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        finalHomeScore: true,
        finalAwayScore: true,
        rawPayload: true,
      },
    }),
  ]);
}
