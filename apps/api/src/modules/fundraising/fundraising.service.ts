import type { Prisma } from '@prisma/client';
import { calculateFundraisingPrizes } from '@bolao/shared';
import { z } from 'zod';
import { prisma } from '../../prisma.js';

export const MAX_FUNDRAISING_CENTS = 100_000_000;
export const FUNDRAISING_DESCRIPTION =
  'Premiação do pódio: 50% para o 1º, 30% para o 2º e 20% para o 3º lugar.';
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
  const amountCents = fundraising?.amountCents ?? 0;
  return {
    poolSeasonId,
    amountCents,
    prizes: calculateFundraisingPrizes(amountCents),
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
