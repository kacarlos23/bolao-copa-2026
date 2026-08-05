import { ContributionTransactionKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  calculateContributionParticipant,
  isRoundEligibleForAccount,
  roundHasStarted,
} from './contributions.service.js';

const NOW = new Date('2026-08-05T12:00:00.000Z');

function account(transactions: Array<Record<string, unknown>> = []) {
  return {
    id: 'account-1',
    userId: 'user-1',
    startRound: 20,
    endRound: null,
    createdAt: NOW,
    updatedAt: NOW,
    user: { id: 'user-1', nickname: 'Leoncio', avatarUrl: null, status: 'ACTIVE' as const },
    transactions: transactions.map((transaction, index) => ({
      id: `transaction-${index + 1}`,
      roundId: 'round-20',
      kind: ContributionTransactionKind.PAYMENT,
      amountCents: 1_000,
      justification: 'Contribuição registrada pelo administrador',
      createdById: 'admin-1',
      voidsTransactionId: null,
      createdAt: NOW,
      voidedByTransaction: null,
      ...transaction,
    })),
  };
}

const membership = {
  userId: 'user-1',
  status: 'ACTIVE' as const,
  user: { id: 'user-1', nickname: 'Leoncio', avatarUrl: null, status: 'ACTIVE' as const },
};

const rounds = [
  { roundId: 'round-20', order: 20, name: 'Rodada 20', startsAt: NOW.toISOString(), hasStarted: true },
  { roundId: 'round-21', order: 21, name: 'Rodada 21', startsAt: '2026-08-12T12:00:00.000Z', hasStarted: false },
];

describe('round contribution summaries', () => {
  it('preserves partial payments, separates due debt from advance, and uses R$10 per round', () => {
    const summary = calculateContributionParticipant({
      account: account([
        { roundId: 'round-20', amountCents: 400 },
        { roundId: 'round-21', amountCents: 1_000 },
      ]),
      membership,
      rounds,
      defaultStartRound: 20,
      amountPerRoundCents: 1_000,
      selectedRoundId: 'round-20',
    });

    expect(summary).toMatchObject({
      paidCents: 1_400,
      dueCents: 1_000,
      outstandingCents: 600,
      advanceCents: 1_000,
      selectedRoundPaymentCents: 400,
      selectedRoundOutstandingCents: 600,
    });
  });

  it('excludes a voided receipt without deleting its payment history', () => {
    const summary = calculateContributionParticipant({
      account: account([
        { id: 'payment-1', roundId: 'round-20', amountCents: 1_000, voidedByTransaction: { id: 'void-1' } },
        {
          id: 'void-1',
          roundId: 'round-20',
          kind: ContributionTransactionKind.VOID,
          amountCents: 1_000,
          voidsTransactionId: 'payment-1',
        },
      ]),
      membership,
      rounds,
      defaultStartRound: 20,
      amountPerRoundCents: 1_000,
    });

    expect(summary.paidCents).toBe(0);
    expect(summary.dueCents).toBe(1_000);
    expect(summary.outstandingCents).toBe(1_000);
  });

  it('uses the first game as the round start when the round date is unavailable', () => {
    expect(
      roundHasStarted(
        {
          id: 'round-20',
          order: 20,
          name: 'Rodada 20',
          status: 'SCHEDULED',
          startsAt: null,
          matches: [{ startsAt: new Date('2026-08-05T11:00:00.000Z') }],
        },
        NOW,
      ),
    ).toBe(true);
  });

  it('does not charge a round after an account end round', () => {
    expect(isRoundEligibleForAccount(20, { startRound: 20, endRound: 22 }, 20)).toBe(true);
    expect(isRoundEligibleForAccount(23, { startRound: 20, endRound: 22 }, 20)).toBe(false);
  });
});
