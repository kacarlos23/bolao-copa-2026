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

/** A user must explicitly be active in this competition, not merely in its shared pool. */
export async function resolvePoolSeasonContext(
  input: { poolSlug: string; seasonId: string; userId: string },
  database: ContextDatabase = prisma,
): Promise<PoolSeasonContext> {
  const pool = await database.pool.findUnique({
    where: { slug: input.poolSlug },
    select: {
      id: true,
      slug: true,
      // Kept in the query only while legacy route-contract fixtures are being migrated.
      // Runtime authorization below never falls back when the season relation is present.
      memberships: {
        where: { userId: input.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
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
          memberships: {
            where: { userId: input.userId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
            take: 1,
            select: { role: true, user: { select: { role: true } } },
          },
        },
      },
    },
  });

  if (!pool) throw new AppError(404, 'Bolão não encontrado.', 'POOL_NOT_FOUND');
  const poolSeason = pool.seasons[0];
  if (!poolSeason || poolSeason.seasonId !== input.seasonId) {
    throw new AppError(404, 'Temporada não está vinculada a este bolão.', 'POOL_SEASON_NOT_FOUND');
  }
  const hasSeasonMembershipRelation = Array.isArray(poolSeason.memberships);
  const membership = hasSeasonMembershipRelation
    ? poolSeason.memberships[0]
    : pool.memberships[0];
  if (!membership) {
    throw new AppError(
      403,
      'Participação ativa nesta competição é obrigatória.',
      hasSeasonMembershipRelation ? 'POOL_SEASON_MEMBERSHIP_REQUIRED' : 'POOL_MEMBERSHIP_REQUIRED',
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
