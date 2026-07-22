import type { Prisma, TieStatus } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { matchSelect } from '../matches/match.repository.js';

export interface TieFilters {
  stageId?: string;
  roundId?: string;
  status?: TieStatus;
}

const teamSelect = {
  id: true,
  name: true,
  code: true,
  flagUrl: true,
  crestUrl: true,
  countryCode: true,
} satisfies Prisma.TeamSelect;

export const tieSelect = {
  id: true,
  seasonId: true,
  stageId: true,
  roundId: true,
  key: true,
  order: true,
  expectedLegs: true,
  status: true,
  decisionMethod: true,
  aggregateTeamAScore: true,
  aggregateTeamBScore: true,
  decidedAt: true,
  lastRecomputedAt: true,
  provenance: true,
  metadata: true,
  teamA: { select: teamSelect },
  teamB: { select: teamSelect },
  winnerTeam: { select: teamSelect },
  matches: { orderBy: { legNumber: 'asc' }, select: matchSelect },
} satisfies Prisma.TieSelect;

function whereFor(seasonId: string, filters: TieFilters): Prisma.TieWhereInput {
  return {
    seasonId,
    ...(filters.stageId ? { stageId: filters.stageId } : {}),
    ...(filters.roundId ? { roundId: filters.roundId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };
}

export function listSeasonTieRecords(
  seasonId: string,
  filters: TieFilters,
  pagination: { skip: number; take: number },
) {
  const where = whereFor(seasonId, filters);
  return Promise.all([
    prisma.tie.findMany({
      where,
      orderBy: [{ round: { order: 'asc' } }, { order: 'asc' }, { id: 'asc' }],
      ...pagination,
      select: tieSelect,
    }),
    prisma.tie.count({ where }),
  ]);
}
