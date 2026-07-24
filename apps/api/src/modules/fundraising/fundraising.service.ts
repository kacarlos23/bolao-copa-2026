import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';

export const MAX_FUNDRAISING_CENTS = 100_000_000;
export const FUNDRAISING_DESCRIPTION = 'Ação entre amigos para custear a viagem';
export const fundraisingAmountCentsSchema = z.number().int().min(0).max(MAX_FUNDRAISING_CENTS);

type FundraisingDatabase = Pick<Prisma.TransactionClient, 'poolSeasonFundraising'>;

export function fundraisingDto(
  poolSeasonId: string,
  fundraising: {
    amountCents: number;
    updatedAt: Date;
    updatedById: string | null;
    lastJustification: string;
  } | null,
) {
  return {
    poolSeasonId,
    amountCents: fundraising?.amountCents ?? 0,
    description: FUNDRAISING_DESCRIPTION,
    updatedAt: fundraising?.updatedAt.toISOString() ?? null,
    updatedById: fundraising?.updatedById ?? null,
    lastJustification: fundraising?.lastJustification ?? null,
  };
}

export async function getPoolSeasonFundraising(
  poolSeasonId: string,
  database: FundraisingDatabase = prisma,
) {
  const fundraising = await database.poolSeasonFundraising.findUnique({
    where: { poolSeasonId },
    select: {
      amountCents: true,
      updatedAt: true,
      updatedById: true,
      lastJustification: true,
    },
  });
  return fundraisingDto(poolSeasonId, fundraising);
}
