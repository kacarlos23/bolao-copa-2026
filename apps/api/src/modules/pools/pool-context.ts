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
        select: { role: true },
      },
      seasons: {
        where: { seasonId: input.seasonId },
        take: 1,
        select: { id: true, seasonId: true },
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
  };
}
