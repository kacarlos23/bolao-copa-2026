import type { MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';

export interface MatchFilters {
  roundId?: string;
  status?: MatchStatus;
  from?: Date;
  to?: Date;
}

const teamSelect = {
  id: true,
  name: true,
  code: true,
  flagUrl: true,
  crestUrl: true,
} satisfies Prisma.TeamSelect;

export const matchSelect = {
  id: true,
  seasonId: true,
  stageId: true,
  roundId: true,
  matchDayId: true,
  startsAt: true,
  predictionClosesAt: true,
  status: true,
  homeScore: true,
  awayScore: true,
  finalHomeScore: true,
  finalAwayScore: true,
  homeTeam: { select: teamSelect },
  awayTeam: { select: teamSelect },
} satisfies Prisma.MatchSelect;

function whereFor(seasonId: string, filters: MatchFilters): Prisma.MatchWhereInput {
  return {
    seasonId,
    ...(filters.roundId ? { roundId: filters.roundId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to
      ? { startsAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lt: filters.to } : {}) } }
      : {}),
  };
}

export function listSeasonMatchRecords(
  seasonId: string,
  filters: MatchFilters,
  pagination: { skip: number; take: number },
) {
  const where = whereFor(seasonId, filters);
  return Promise.all([
    prisma.match.findMany({
      where,
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      ...pagination,
      select: matchSelect,
    }),
    prisma.match.count({ where }),
  ]);
}
