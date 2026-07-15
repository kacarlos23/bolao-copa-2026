import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { AppError } from '../../http/errors.js';

type ContextDatabase = Pick<Prisma.TransactionClient, 'pool'>;

export interface PoolSeasonContext {
  poolId: string;
  poolSlug: string;
  poolSeasonId: string;
  seasonId: string;
  membershipRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  systemRole: 'USER' | 'ADMIN';
  scoreableFromRound: number | null;
  scoreableFrom: Date | null;
  startsAtRound: number | null;
  historicalMatchesScoreable: boolean;
}

export async function resolvePoolSeasonContext(
  input: { poolSlug: string; seasonId: string; userId: string },
  database: ContextDatabase = prisma,
): Promise<PoolSeasonContext> {
  const pool = await database.pool.findUnique({
    where: { slug: input.poolSlug },
    select: {
      id: true,
      slug: true,
      memberships: {
        where: {
          userId: input.userId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
        take: 1,
        select: { role: true, user: { select: { role: true } } },
      },
      seasons: {
        where: { seasonId: input.seasonId },
        take: 1,
        select: {
          id: true,
          seasonId: true,
          scoreableFromRound: true,
          scoreableFrom: true,
          startsAtRound: true,
          historicalMatchesScoreable: true,
        },
      },
    },
  });

  if (!pool) throw new AppError(404, 'Bolão não encontrado.', 'POOL_NOT_FOUND');
  const membership = pool.memberships[0];
  if (!membership) {
    throw new AppError(403, 'Participação ativa no bolão é obrigatória.', 'POOL_MEMBERSHIP_REQUIRED');
  }
  const poolSeason = pool.seasons[0];
  if (!poolSeason || poolSeason.seasonId !== input.seasonId) {
    throw new AppError(
      404,
      'Temporada não está vinculada a este bolão.',
      'POOL_SEASON_NOT_FOUND',
    );
  }

  return {
    poolId: pool.id,
    poolSlug: pool.slug,
    poolSeasonId: poolSeason.id,
    seasonId: poolSeason.seasonId,
    membershipRole: membership.role,
    systemRole: membership.user?.role ?? 'USER',
    scoreableFromRound: poolSeason.scoreableFromRound ?? null,
    scoreableFrom: poolSeason.scoreableFrom ?? null,
    startsAtRound: poolSeason.startsAtRound ?? null,
    historicalMatchesScoreable: poolSeason.historicalMatchesScoreable ?? false,
  };
}
