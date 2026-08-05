import type { Prisma } from '@prisma/client';
import { ContributionTransactionKind } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { AppError } from '../../http/errors.js';

/** This feature is deliberately independent from the manual fundraising pot. */
export const CONTRIBUTION_AMOUNT_PER_ROUND_CENTS = 1_000;
export const MAX_CONTRIBUTION_PAYMENT_CENTS = CONTRIBUTION_AMOUNT_PER_ROUND_CENTS;
export const CONTRIBUTION_DEFAULT_START_ROUND = 20;

type ContributionDatabase = typeof prisma | Prisma.TransactionClient;

export type ContributionRound = {
  roundId: string;
  order: number;
  name: string;
  startsAt: string | null;
  hasStarted: boolean;
};

type RawRound = {
  id: string;
  order: number;
  name: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'FINISHED';
  startsAt: Date | null;
  matches: Array<{ startsAt: Date }>;
};

type RawTransaction = {
  id: string;
  roundId: string;
  kind: ContributionTransactionKind;
  amountCents: number;
  justification: string;
  createdById: string | null;
  voidsTransactionId: string | null;
  createdAt: Date;
  voidedByTransaction: { id: string } | null;
};

type RawAccount = {
  id: string;
  userId: string;
  startRound: number;
  endRound: number | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; nickname: string; avatarUrl: string | null; status: 'ACTIVE' | 'BLOCKED' };
  transactions: RawTransaction[];
};

type RawMembership = {
  userId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'REMOVED';
  user: { id: string; nickname: string; avatarUrl: string | null; status: 'ACTIVE' | 'BLOCKED' };
};

export type ContributionTotals = {
  paidCents: number;
  dueCents: number;
  outstandingCents: number;
  advanceCents: number;
};

export type ContributionParticipant = ContributionTotals & {
  accountId: string | null;
  userId: string;
  nickname: string;
  avatarUrl: string | null;
  membershipStatus: 'ACTIVE' | 'INACTIVE' | 'REMOVED' | null;
  contributionConfigured: boolean;
  contributionStartRound: number | null;
  contributionEndRound: number | null;
  /** Kept as a UI-friendly alias for paidCents. */
  paymentCents: number;
  selectedRoundPaymentCents: number | null;
  selectedRoundOutstandingCents: number | null;
};

export type ContributionTransaction = {
  id: string;
  accountId: string;
  userId: string;
  roundId: string;
  kind: ContributionTransactionKind;
  amountCents: number;
  justification: string;
  createdById: string | null;
  createdAt: string;
  voidsTransactionId: string | null;
  voidedByTransactionId: string | null;
};

export type ContributionOverview = {
  poolSeasonId: string;
  amountPerRoundCents: number;
  defaultStartRound: number;
  dueThroughRound: number | null;
  totals: ContributionTotals;
  participants: ContributionParticipant[];
  rounds?: ContributionRound[];
  selectedRoundId?: string | null;
  transactions?: ContributionTransaction[];
};

export type ContributionLookup = {
  poolSeasonId: string;
  seasonId: string;
  config: { amountPerRoundCents: number; defaultStartRound: number };
  rounds: RawRound[];
  memberships: RawMembership[];
  accounts: RawAccount[];
};

function notConfigured(): never {
  throw new AppError(
    404,
    'O controle de contribuições não está configurado para esta competição.',
    'CONTRIBUTIONS_NOT_CONFIGURED',
  );
}

function contributionConfigurationInvalid(): never {
  throw new AppError(
    409,
    'A configuração de contribuições está inválida.',
    'CONTRIBUTION_CONFIGURATION_INVALID',
  );
}

function effectiveRoundStart(round: RawRound) {
  const values = [round.startsAt, ...round.matches.map((match) => match.startsAt)]
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  return values.length > 0 ? new Date(Math.min(...values)) : null;
}

export function roundHasStarted(round: RawRound, now = new Date()) {
  if (round.status === 'ACTIVE' || round.status === 'FINISHED') return true;
  const startsAt = effectiveRoundStart(round);
  return startsAt != null && startsAt.getTime() <= now.getTime();
}

export function contributionRounds(rounds: RawRound[], defaultStartRound: number, now = new Date()) {
  return rounds
    .filter((round) => round.order >= defaultStartRound)
    .map((round) => {
      const startsAt = effectiveRoundStart(round);
      return {
        roundId: round.id,
        order: round.order,
        name: round.name,
        startsAt: startsAt?.toISOString() ?? null,
        hasStarted: roundHasStarted(round, now),
      };
    });
}

export function isRoundEligibleForAccount(
  roundOrder: number,
  account: Pick<RawAccount, 'startRound' | 'endRound'>,
  defaultStartRound: number,
) {
  return (
    roundOrder >= Math.max(defaultStartRound, account.startRound) &&
    (account.endRound == null || roundOrder <= account.endRound)
  );
}

function activePayments(transactions: RawTransaction[]) {
  return transactions.filter(
    (transaction) =>
      transaction.kind === ContributionTransactionKind.PAYMENT &&
      transaction.voidedByTransaction == null,
  );
}

export function calculateContributionParticipant(input: {
  account: RawAccount | null;
  membership: RawMembership | null;
  rounds: ContributionRound[];
  defaultStartRound: number;
  amountPerRoundCents: number;
  selectedRoundId?: string | null;
}): ContributionParticipant {
  const { account, membership, rounds, defaultStartRound, amountPerRoundCents, selectedRoundId } = input;
  const user = membership?.user ?? account?.user;
  if (!user) {
    throw new AppError(409, 'Conta de contribuição sem participante.', 'CONTRIBUTION_ACCOUNT_ORPHANED');
  }
  if (!account) {
    return {
      accountId: null,
      userId: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      membershipStatus: membership?.status ?? null,
      contributionConfigured: false,
      contributionStartRound: null,
      contributionEndRound: null,
      paidCents: 0,
      paymentCents: 0,
      dueCents: 0,
      outstandingCents: 0,
      advanceCents: 0,
      selectedRoundPaymentCents: null,
      selectedRoundOutstandingCents: null,
    };
  }

  const payments = activePayments(account.transactions);
  const paidByRound = new Map<string, number>();
  for (const payment of payments) {
    paidByRound.set(payment.roundId, (paidByRound.get(payment.roundId) ?? 0) + payment.amountCents);
  }

  let dueCents = 0;
  let outstandingCents = 0;
  let advanceCents = 0;
  let selectedRoundPaymentCents: number | null = null;
  let selectedRoundOutstandingCents: number | null = null;

  for (const round of rounds) {
    if (!isRoundEligibleForAccount(round.order, account, defaultStartRound)) continue;
    const paidCents = paidByRound.get(round.roundId) ?? 0;
    if (round.hasStarted) {
      dueCents += amountPerRoundCents;
      outstandingCents += Math.max(0, amountPerRoundCents - paidCents);
    } else {
      advanceCents += paidCents;
    }
    if (selectedRoundId === round.roundId) {
      selectedRoundPaymentCents = paidCents;
      selectedRoundOutstandingCents = Math.max(0, amountPerRoundCents - paidCents);
    }
  }

  const paidCents = payments.reduce((total, payment) => total + payment.amountCents, 0);
  return {
    accountId: account.id,
    userId: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    membershipStatus: membership?.status ?? null,
    contributionConfigured: true,
    contributionStartRound: account.startRound,
    contributionEndRound: account.endRound,
    paidCents,
    paymentCents: paidCents,
    dueCents,
    outstandingCents,
    advanceCents,
    selectedRoundPaymentCents,
    selectedRoundOutstandingCents,
  };
}

function totalsFromParticipants(participants: ContributionParticipant[]): ContributionTotals {
  return participants.reduce<ContributionTotals>(
    (totals, participant) => ({
      paidCents: totals.paidCents + participant.paidCents,
      dueCents: totals.dueCents + participant.dueCents,
      outstandingCents: totals.outstandingCents + participant.outstandingCents,
      advanceCents: totals.advanceCents + participant.advanceCents,
    }),
    { paidCents: 0, dueCents: 0, outstandingCents: 0, advanceCents: 0 },
  );
}

export async function getContributionLookup(
  poolSeasonId: string,
  database: ContributionDatabase = prisma,
): Promise<ContributionLookup> {
  const poolSeason = await database.poolSeason.findUnique({
    where: { id: poolSeasonId },
    select: {
      id: true,
      seasonId: true,
      contributionConfig: {
        select: { amountPerRoundCents: true, defaultStartRound: true },
      },
      memberships: {
        select: {
          userId: true,
          status: true,
          user: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
        },
      },
      contributionAccounts: {
        select: {
          id: true,
          userId: true,
          startRound: true,
          endRound: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, nickname: true, avatarUrl: true, status: true } },
          transactions: {
            select: {
              id: true,
              roundId: true,
              kind: true,
              amountCents: true,
              justification: true,
              createdById: true,
              voidsTransactionId: true,
              createdAt: true,
              voidedByTransaction: { select: { id: true } },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      },
      season: {
        select: {
          rounds: {
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              order: true,
              name: true,
              status: true,
              startsAt: true,
              matches: {
                orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
                take: 1,
                select: { startsAt: true },
              },
            },
          },
        },
      },
    },
  });

  if (!poolSeason || !poolSeason.contributionConfig) notConfigured();
  const config = poolSeason.contributionConfig;
  if (
    config.amountPerRoundCents !== CONTRIBUTION_AMOUNT_PER_ROUND_CENTS ||
    config.defaultStartRound !== CONTRIBUTION_DEFAULT_START_ROUND
  ) {
    contributionConfigurationInvalid();
  }

  return {
    poolSeasonId: poolSeason.id,
    seasonId: poolSeason.seasonId,
    config,
    rounds: poolSeason.season.rounds,
    memberships: poolSeason.memberships,
    accounts: poolSeason.contributionAccounts,
  };
}

export async function getContributionOverview(
  input: {
    poolSeasonId: string;
    includeInactive?: boolean;
    includeTransactions?: boolean;
    selectedRoundId?: string | null;
    now?: Date;
  },
  database: ContributionDatabase = prisma,
): Promise<ContributionOverview> {
  const lookup = await getContributionLookup(input.poolSeasonId, database);
  const now = input.now ?? new Date();
  const rounds = contributionRounds(lookup.rounds, lookup.config.defaultStartRound, now);
  const selectedRoundId = input.selectedRoundId ?? null;
  if (selectedRoundId && !rounds.some((round) => round.roundId === selectedRoundId)) {
    throw new AppError(400, 'Rodada não elegível para contribuição.', 'CONTRIBUTION_ROUND_NOT_ELIGIBLE');
  }

  const accountByUser = new Map(lookup.accounts.map((account) => [account.userId, account]));
  const activeMemberships = lookup.memberships.filter(
    (membership) => membership.status === 'ACTIVE' && membership.user.status === 'ACTIVE',
  );
  const memberships = input.includeInactive ? lookup.memberships : activeMemberships;
  const membershipByUser = new Map(memberships.map((membership) => [membership.userId, membership]));
  const participants = memberships
    .map((membership) =>
      calculateContributionParticipant({
        account: accountByUser.get(membership.userId) ?? null,
        membership,
        rounds,
        defaultStartRound: lookup.config.defaultStartRound,
        amountPerRoundCents: lookup.config.amountPerRoundCents,
        selectedRoundId,
      }),
    )
    .sort((left, right) => left.nickname.localeCompare(right.nickname, 'pt-BR'));

  // A removed membership should not disappear from administrative history even
  // if a legacy data repair left its account without a membership row.
  if (input.includeInactive) {
    for (const account of lookup.accounts) {
      if (membershipByUser.has(account.userId)) continue;
      participants.push(
        calculateContributionParticipant({
          account,
          membership: null,
          rounds,
          defaultStartRound: lookup.config.defaultStartRound,
          amountPerRoundCents: lookup.config.amountPerRoundCents,
          selectedRoundId,
        }),
      );
    }
    participants.sort((left, right) => left.nickname.localeCompare(right.nickname, 'pt-BR'));
  }

  const overview: ContributionOverview = {
    poolSeasonId: lookup.poolSeasonId,
    amountPerRoundCents: lookup.config.amountPerRoundCents,
    defaultStartRound: lookup.config.defaultStartRound,
    dueThroughRound:
      rounds.filter((round) => round.hasStarted).at(-1)?.order ?? null,
    totals: totalsFromParticipants(participants),
    participants,
  };

  if (input.includeTransactions) {
    overview.rounds = rounds;
    overview.selectedRoundId = selectedRoundId;
    overview.transactions = lookup.accounts.flatMap((account) =>
      account.transactions.map((transaction) => ({
        id: transaction.id,
        accountId: account.id,
        userId: account.userId,
        roundId: transaction.roundId,
        kind: transaction.kind,
        amountCents: transaction.amountCents,
        justification: transaction.justification,
        createdById: transaction.createdById,
        createdAt: transaction.createdAt.toISOString(),
        voidsTransactionId: transaction.voidsTransactionId,
        voidedByTransactionId: transaction.voidedByTransaction?.id ?? null,
      })),
    );
  }
  return overview;
}

export function assertEligibleAccountRound(input: {
  account: Pick<RawAccount, 'startRound' | 'endRound'>;
  config: { defaultStartRound: number };
  round: Pick<RawRound, 'order'> | null;
}) {
  if (!input.round || !isRoundEligibleForAccount(input.round.order, input.account, input.config.defaultStartRound)) {
    throw new AppError(
      400,
      'A rodada não está dentro do período de contribuição do participante.',
      'CONTRIBUTION_ACCOUNT_ROUND_INELIGIBLE',
    );
  }
}

export function assertContributionAmount(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_CONTRIBUTION_PAYMENT_CENTS) {
    throw new AppError(
      400,
      'O pagamento deve estar entre R$ 0,01 e R$ 10,00.',
      'CONTRIBUTION_AMOUNT_INVALID',
    );
  }
}
