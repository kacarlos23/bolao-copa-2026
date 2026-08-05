import { ContributionTransactionKind, type Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler.js';
import { AppError } from '../../http/errors.js';
import { requireAdmin, requireAuth } from '../../middleware/auth.js';
import { prisma } from '../../prisma.js';
import {
  adminRequestContext,
  createAdminPreview,
  entityIdSchema,
  executeSensitiveMutation,
  justificationSchema,
  reinforcedConfirmationSchema,
  setAdminScope,
} from '../admin/admin-security.js';
import { assertCompetitionFeature } from '../competitions/competition-feature.service.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import { resolvePoolSeasonContext } from '../pools/pool-context.js';
import {
  assertContributionAmount,
  assertEligibleAccountRound,
  CONTRIBUTION_AMOUNT_PER_ROUND_CENTS,
  getContributionLookup,
  getContributionOverview,
  roundHasStarted,
  type ContributionOverview,
} from './contributions.service.js';

export const publicContributionRouter = Router();
export const adminContributionRouter = Router();

publicContributionRouter.use(requireAuth);
adminContributionRouter.use(requireAdmin);

const publicParamsSchema = z
  .object({
    poolSlug: z.string().trim().min(1).max(100),
    seasonId: entityIdSchema,
  })
  .strict();

const adminQuerySchema = z
  .object({
    seasonId: entityIdSchema,
    poolSeasonId: entityIdSchema,
    roundId: entityIdSchema.optional(),
  })
  .strict();

const paymentInputSchema = z
  .object({
    action: z.literal('PAYMENT'),
    seasonId: entityIdSchema,
    poolSeasonId: entityIdSchema,
    userId: entityIdSchema,
    roundId: entityIdSchema,
    amountCents: z.number().int().min(1).max(CONTRIBUTION_AMOUNT_PER_ROUND_CENTS),
  })
  .strict();

const paymentSchema = paymentInputSchema.extend({ justification: justificationSchema }).strict();

const voidSchema = z
  .object({
    action: z.literal('VOID'),
    seasonId: entityIdSchema,
    poolSeasonId: entityIdSchema,
    transactionId: entityIdSchema,
    justification: justificationSchema,
  })
  .strict();

const accountSchema = z
  .object({
    action: z.literal('ACCOUNT'),
    seasonId: entityIdSchema,
    poolSeasonId: entityIdSchema,
    userId: entityIdSchema,
    startRound: z.number().int().min(1).max(100).optional(),
    // null deliberately re-opens a participant account after a temporary end.
    endRound: z.number().int().min(1).max(100).nullable().optional(),
    justification: justificationSchema,
  })
  .strict();

const contributionActionSchema = z.discriminatedUnion('action', [paymentSchema, voidSchema, accountSchema]);
const contributionWriteSchema = z.discriminatedUnion('action', [
  paymentSchema.extend(reinforcedConfirmationSchema.shape).strict(),
  voidSchema.extend(reinforcedConfirmationSchema.shape).strict(),
  accountSchema.extend(reinforcedConfirmationSchema.shape).strict(),
]);
type ContributionAction = z.infer<typeof contributionActionSchema>;
type ContributionDatabase = typeof prisma | Prisma.TransactionClient;
type ContributionMutationResult = {
  contribution: ContributionOverview;
  eventId: string;
  payment?: { id: string; amountCents: number; roundId: string };
  voided?: { id: string; voidsTransactionId: string | null; amountCents: number; roundId: string };
  account?: { id: string; userId: string; startRound: number; endRound: number | null };
};

const DIRECT_PAYMENT_JUSTIFICATION =
  'Pagamento de contribuição registrado diretamente pelo administrador.';

function contributionOperation(action: ContributionAction['action']) {
  if (action === 'PAYMENT') return 'CONTRIBUTION_PAYMENT';
  if (action === 'VOID') return 'CONTRIBUTION_VOID';
  return 'CONTRIBUTION_ACCOUNT';
}

function contributionAuditAction(action: ContributionAction['action']) {
  if (action === 'PAYMENT') return 'CONTRIBUTION_PAYMENT_RECORDED' as const;
  if (action === 'VOID') return 'CONTRIBUTION_PAYMENT_VOIDED' as const;
  return 'CONTRIBUTION_ACCOUNT_UPDATED' as const;
}

function contributionScope(body: ContributionAction) {
  if (body.action === 'VOID') {
    return {
      targetType: 'PoolSeasonContributionTransaction',
      targetId: body.transactionId,
      seasonId: body.seasonId,
      poolSeasonId: body.poolSeasonId,
    };
  }
  return {
    targetType: 'PoolSeasonContributionAccount',
    targetId: body.userId,
    seasonId: body.seasonId,
    poolSeasonId: body.poolSeasonId,
  };
}

function contributionRequest(body: ContributionAction) {
  if (body.action === 'PAYMENT') {
    return {
      action: body.action,
      userId: body.userId,
      roundId: body.roundId,
      amountCents: body.amountCents,
      justification: body.justification,
    };
  }
  if (body.action === 'VOID') {
    return { action: body.action, transactionId: body.transactionId, justification: body.justification };
  }
  return {
    action: body.action,
    userId: body.userId,
    justification: body.justification,
    ...(body.startRound === undefined ? {} : { startRound: body.startRound }),
    ...(body.endRound === undefined ? {} : { endRound: body.endRound }),
  };
}

function ensureSeason(lookup: Awaited<ReturnType<typeof getContributionLookup>>, seasonId: string) {
  if (lookup.seasonId !== seasonId) {
    throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
  }
}

function activePaymentCentsForRound(
  account: Awaited<ReturnType<typeof getContributionLookup>>['accounts'][number],
  roundId: string,
) {
  return account.transactions
    .filter(
      (transaction) =>
        transaction.kind === ContributionTransactionKind.PAYMENT &&
        transaction.voidedByTransaction == null &&
        transaction.roundId === roundId,
    )
    .reduce((total, transaction) => total + transaction.amountCents, 0);
}

async function preparePayment(body: z.infer<typeof paymentSchema>, database: ContributionDatabase = prisma) {
  assertContributionAmount(body.amountCents);
  const lookup = await getContributionLookup(body.poolSeasonId, database);
  ensureSeason(lookup, body.seasonId);
  const membership = lookup.memberships.find((item) => item.userId === body.userId);
  if (!membership) {
    throw new AppError(404, 'Participante não pertence a esta competição.', 'CONTRIBUTION_MEMBER_NOT_FOUND');
  }
  const account = lookup.accounts.find((item) => item.userId === body.userId);
  if (!account) {
    throw new AppError(
      409,
      'Defina a rodada inicial de contribuição antes de registrar pagamentos.',
      'CONTRIBUTION_ACCOUNT_NOT_CONFIGURED',
    );
  }
  const round = lookup.rounds.find((item) => item.id === body.roundId) ?? null;
  assertEligibleAccountRound({ account, config: lookup.config, round });
  const paidCents = activePaymentCentsForRound(account, body.roundId);
  if (paidCents + body.amountCents > lookup.config.amountPerRoundCents) {
    throw new AppError(
      409,
      'O pagamento ultrapassa R$ 10,00 para esta rodada.',
      'CONTRIBUTION_ROUND_PAYMENT_LIMIT',
    );
  }
  return { lookup, membership, account, round: round!, paidCents };
}

async function prepareVoid(body: z.infer<typeof voidSchema>, database: ContributionDatabase = prisma) {
  const lookup = await getContributionLookup(body.poolSeasonId, database);
  ensureSeason(lookup, body.seasonId);
  const account = lookup.accounts.find((item) =>
    item.transactions.some((transaction) => transaction.id === body.transactionId),
  );
  const transaction = account?.transactions.find((item) => item.id === body.transactionId) ?? null;
  if (!account || !transaction) {
    throw new AppError(404, 'Lançamento de contribuição não encontrado.', 'CONTRIBUTION_TRANSACTION_NOT_FOUND');
  }
  if (transaction.kind !== ContributionTransactionKind.PAYMENT) {
    throw new AppError(409, 'Somente pagamentos podem ser estornados.', 'CONTRIBUTION_VOID_NOT_PAYMENT');
  }
  if (transaction.voidedByTransaction != null) {
    throw new AppError(409, 'Este pagamento já foi estornado.', 'CONTRIBUTION_PAYMENT_ALREADY_VOIDED');
  }
  const round = lookup.rounds.find((item) => item.id === transaction.roundId) ?? null;
  assertEligibleAccountRound({ account, config: lookup.config, round });
  return { lookup, account, transaction, round: round! };
}

async function prepareAccount(body: z.infer<typeof accountSchema>, database: ContributionDatabase = prisma) {
  const lookup = await getContributionLookup(body.poolSeasonId, database);
  ensureSeason(lookup, body.seasonId);
  const membership = lookup.memberships.find((item) => item.userId === body.userId) ?? null;
  const account = lookup.accounts.find((item) => item.userId === body.userId) ?? null;
  // Configure and audit a new account before the membership-status endpoint
  // activates its PoolSeasonMembership. The legacy admin manager can select
  // any existing system user, so preserve that supported workflow here.
  const requestedUser =
    membership || account
      ? null
      : await database.user.findUnique({
          where: { id: body.userId },
          select: { id: true, nickname: true, avatarUrl: true, status: true },
        });
  const user = membership?.user ?? account?.user ?? requestedUser ?? null;
  if (!user) {
    throw new AppError(404, 'Participante não pertence a esta competição.', 'CONTRIBUTION_MEMBER_NOT_FOUND');
  }
  if (user.status !== 'ACTIVE') {
    throw new AppError(409, 'Usuário inativo não pode ter contribuições configuradas.', 'CONTRIBUTION_USER_INACTIVE');
  }
  if (!account && body.startRound === undefined) {
    throw new AppError(
      400,
      'A rodada inicial é obrigatória ao configurar um novo participante.',
      'CONTRIBUTION_START_ROUND_REQUIRED',
    );
  }
  const startRound = body.startRound ?? account!.startRound;
  const endRound = body.endRound === undefined ? account?.endRound ?? null : body.endRound;
  const roundOrders = new Set(lookup.rounds.map((round) => round.order));
  if (
    startRound < lookup.config.defaultStartRound ||
    !roundOrders.has(startRound) ||
    (endRound != null && (!roundOrders.has(endRound) || endRound < startRound))
  ) {
    throw new AppError(
      400,
      `O período de contribuição deve usar rodadas válidas a partir da rodada ${lookup.config.defaultStartRound}.`,
      'CONTRIBUTION_ACCOUNT_RANGE_INVALID',
    );
  }
  if (account) {
    const roundById = new Map(lookup.rounds.map((round) => [round.id, round]));
    const historicalOrders = account.transactions
      .filter((transaction) => transaction.kind === ContributionTransactionKind.PAYMENT)
      .map((transaction) => roundById.get(transaction.roundId)?.order)
      .filter((order): order is number => order != null);
    if (
      historicalOrders.some(
        (order) => order < startRound || (endRound != null && order > endRound),
      )
    ) {
      throw new AppError(
        409,
        'O novo período excluiria um lançamento histórico.',
        'CONTRIBUTION_ACCOUNT_HISTORY_OUT_OF_RANGE',
      );
    }
  }
  return { lookup, membership, account, user, startRound, endRound };
}

function participantFrom(
  overview: ContributionOverview,
  userId: string,
) {
  const participant = overview.participants.find((item) => item.userId === userId);
  if (!participant) {
    throw new AppError(409, 'Participante ausente do resumo de contribuições.', 'CONTRIBUTION_SUMMARY_MISSING');
  }
  return participant;
}

async function adminOverview(
  poolSeasonId: string,
  roundId?: string,
  database: ContributionDatabase = prisma,
) {
  return getContributionOverview(
    { poolSeasonId, includeInactive: true, includeTransactions: true, selectedRoundId: roundId },
    database,
  );
}

/** Public ranking consumers receive financial totals only: no account schedule,
 * transaction history, audit justification, or round-level payment details. */
function publicContributionOverview(overview: ContributionOverview) {
  return {
    poolSeasonId: overview.poolSeasonId,
    amountPerRoundCents: overview.amountPerRoundCents,
    defaultStartRound: overview.defaultStartRound,
    dueThroughRound: overview.dueThroughRound,
    totals: overview.totals,
    participants: overview.participants.map(
      ({
        accountId: _accountId,
        membershipStatus: _membershipStatus,
        contributionConfigured: _contributionConfigured,
        contributionStartRound: _contributionStartRound,
        contributionEndRound: _contributionEndRound,
        selectedRoundPaymentCents: _selectedRoundPaymentCents,
        selectedRoundOutstandingCents: _selectedRoundOutstandingCents,
        ...participant
      }) => participant,
    ),
  };
}

async function eventForContribution(
  tx: Prisma.TransactionClient,
  body: ContributionAction,
  idempotencyKey: string,
) {
  const contribution = await getContributionOverview({ poolSeasonId: body.poolSeasonId }, tx);
  return enqueueOutboxEvent(tx, {
    type: 'contributions.updated',
    seasonId: body.seasonId,
    poolSeasonId: body.poolSeasonId,
    payload: { action: body.action, contribution: publicContributionOverview(contribution) },
    idempotencyKey: `contributions.updated:${idempotencyKey}`,
  });
}

publicContributionRouter.get(
  '/:poolSlug/seasons/:seasonId/contributions',
  asyncHandler(async (req, res) => {
    const params = publicParamsSchema.parse(req.params);
    res.locals.poolSlug = params.poolSlug;
    res.locals.seasonId = params.seasonId;
    const context = await resolvePoolSeasonContext({ ...params, userId: req.session.user!.id });
    await assertCompetitionFeature(context.seasonId, 'read', req.session.user!.role);
    res.locals.poolSeasonId = context.poolSeasonId;
    res.json({
      contribution: publicContributionOverview(
        await getContributionOverview({ poolSeasonId: context.poolSeasonId }),
      ),
    });
  }),
);

adminContributionRouter.get(
  '/contributions',
  asyncHandler(async (req, res) => {
    const query = adminQuerySchema.parse(req.query);
    setAdminScope(req, query);
    const contribution = await adminOverview(query.poolSeasonId, query.roundId);
    const lookup = await getContributionLookup(query.poolSeasonId);
    ensureSeason(lookup, query.seasonId);
    res.json({ contribution });
  }),
);

/**
 * Routine payments are intentionally one-step: the admin does not need to enter
 * a repetitive reason or type a confirmation proof. The immutable transaction,
 * idempotency record, before/after audit and realtime event remain in place.
 */
adminContributionRouter.post(
  '/contributions/payment',
  asyncHandler(async (req, res) => {
    const input = paymentInputSchema.parse(req.body);
    const body: z.infer<typeof paymentSchema> = {
      ...input,
      justification: DIRECT_PAYMENT_JUSTIFICATION,
    };
    setAdminScope(req, body);
    const context = adminRequestContext(req);
    const scope = contributionScope(body);
    const response = await executeSensitiveMutation<ContributionMutationResult>({
      context,
      action: contributionAuditAction(body.action),
      operation: contributionOperation(body.action),
      scope,
      justification: body.justification,
      request: contributionRequest(body),
      mutate: async (tx) => {
        const prepared = await preparePayment(body, tx);
        const before = await adminOverview(body.poolSeasonId, body.roundId, tx);
        const payment = await tx.poolSeasonContributionTransaction.create({
          data: {
            accountId: prepared.account.id,
            roundId: body.roundId,
            kind: ContributionTransactionKind.PAYMENT,
            amountCents: body.amountCents,
            justification: body.justification,
            createdById: context.actorId,
          },
          select: { id: true, amountCents: true, roundId: true },
        });
        const contribution = await adminOverview(body.poolSeasonId, body.roundId, tx);
        const event = await eventForContribution(tx, body, context.idempotencyKey);
        return {
          before,
          after: contribution,
          result: { contribution, eventId: event.id, payment },
          affectedCount: 1,
          details: {
            action: body.action,
            userId: body.userId,
            roundId: body.roundId,
            amountCents: body.amountCents,
          },
        };
      },
    });
    await dispatchOutboxEvent(response.result.eventId);
    res.json({
      contribution: response.result.contribution,
      mutation: { payment: response.result.payment },
      affectedCount: response.affectedCount,
      replayed: response.replayed,
    });
  }),
);

adminContributionRouter.post(
  '/contributions/preview',
  asyncHandler(async (req, res) => {
    const body = contributionActionSchema.parse(req.body);
    setAdminScope(req, body);
    const scope = contributionScope(body);
    const context = adminRequestContext(req);
    if (body.action === 'PAYMENT') {
      const prepared = await preparePayment(body);
      const overview = await adminOverview(body.poolSeasonId, body.roundId);
      const participant = participantFrom(overview, body.userId);
      const after = {
        ...participant,
        paidCents: participant.paidCents + body.amountCents,
        paymentCents: participant.paymentCents + body.amountCents,
        outstandingCents: Math.max(0, participant.outstandingCents - (prepared.round ? body.amountCents : 0)),
        advanceCents:
          participant.advanceCents +
          (overview.rounds?.find((round) => round.roundId === body.roundId)?.hasStarted ? 0 : body.amountCents),
        selectedRoundPaymentCents: (participant.selectedRoundPaymentCents ?? 0) + body.amountCents,
        selectedRoundOutstandingCents: Math.max(
          0,
          (participant.selectedRoundOutstandingCents ?? prepared.lookup.config.amountPerRoundCents) - body.amountCents,
        ),
      };
      res.json(
        await createAdminPreview({
          context,
          action: contributionOperation(body.action),
          scope,
          justification: body.justification,
          request: contributionRequest(body),
          preview: {
            action: body.action,
            participant: { userId: body.userId, nickname: prepared.membership.user.nickname },
            round: { id: prepared.round.id, order: prepared.round.order, name: prepared.round.name },
            before: participant,
            after,
            remainingCents: prepared.lookup.config.amountPerRoundCents - prepared.paidCents - body.amountCents,
          },
          affectedCount: 1,
        }),
      );
      return;
    }
    if (body.action === 'VOID') {
      const prepared = await prepareVoid(body);
      const overview = await adminOverview(body.poolSeasonId, prepared.transaction.roundId);
      const participant = participantFrom(overview, prepared.account.userId);
      const roundIsDue = roundHasStarted(prepared.round);
      res.json(
        await createAdminPreview({
          context,
          action: contributionOperation(body.action),
          scope,
          justification: body.justification,
          request: contributionRequest(body),
          preview: {
            action: body.action,
            transaction: {
              id: prepared.transaction.id,
              userId: prepared.account.userId,
              roundId: prepared.transaction.roundId,
              amountCents: prepared.transaction.amountCents,
            },
            before: participant,
            after: {
              ...participant,
              paidCents: participant.paidCents - prepared.transaction.amountCents,
              paymentCents: participant.paymentCents - prepared.transaction.amountCents,
              outstandingCents: roundIsDue
                ? participant.outstandingCents + prepared.transaction.amountCents
                : participant.outstandingCents,
              advanceCents: roundIsDue
                ? participant.advanceCents
                : Math.max(0, participant.advanceCents - prepared.transaction.amountCents),
            },
          },
          affectedCount: 1,
        }),
      );
      return;
    }
    const prepared = await prepareAccount(body);
    res.json(
      await createAdminPreview({
        context,
        action: contributionOperation(body.action),
        scope,
        justification: body.justification,
        request: contributionRequest(body),
        preview: {
          action: body.action,
          participant: { userId: body.userId, nickname: prepared.user.nickname, status: prepared.membership?.status ?? 'PENDING' },
          before: prepared.account
            ? { startRound: prepared.account.startRound, endRound: prepared.account.endRound }
            : null,
          after: { startRound: prepared.startRound, endRound: prepared.endRound },
        },
        affectedCount: prepared.membership ? 1 : 2,
      }),
    );
  }),
);

adminContributionRouter.put(
  '/contributions',
  asyncHandler(async (req, res) => {
    const body = contributionWriteSchema.parse(req.body) as ContributionAction & z.infer<typeof reinforcedConfirmationSchema>;
    setAdminScope(req, body);
    const context = adminRequestContext(req);
    const scope = contributionScope(body);
    const response = await executeSensitiveMutation<ContributionMutationResult>({
      context,
      action: contributionAuditAction(body.action),
      operation: contributionOperation(body.action),
      scope,
      justification: body.justification,
      request: contributionRequest(body),
      confirmation: { previewId: body.previewId, confirmation: body.confirmation },
      mutate: async (tx) => {
        if (body.action === 'PAYMENT') {
          const prepared = await preparePayment(body, tx);
          const before = await adminOverview(body.poolSeasonId, body.roundId, tx);
          const payment = await tx.poolSeasonContributionTransaction.create({
            data: {
              accountId: prepared.account.id,
              roundId: body.roundId,
              kind: ContributionTransactionKind.PAYMENT,
              amountCents: body.amountCents,
              justification: body.justification,
              createdById: context.actorId,
            },
            select: { id: true, amountCents: true, roundId: true },
          });
          const contribution = await adminOverview(body.poolSeasonId, body.roundId, tx);
          const event = await eventForContribution(tx, body, context.idempotencyKey);
          return {
            before,
            after: contribution,
            result: { contribution, eventId: event.id, payment },
            affectedCount: 1,
            details: { action: body.action, userId: body.userId, roundId: body.roundId, amountCents: body.amountCents },
          };
        }
        if (body.action === 'VOID') {
          const prepared = await prepareVoid(body, tx);
          const before = await adminOverview(body.poolSeasonId, prepared.transaction.roundId, tx);
          const voided = await tx.poolSeasonContributionTransaction.create({
            data: {
              accountId: prepared.account.id,
              roundId: prepared.transaction.roundId,
              kind: ContributionTransactionKind.VOID,
              amountCents: prepared.transaction.amountCents,
              justification: body.justification,
              createdById: context.actorId,
              voidsTransactionId: prepared.transaction.id,
            },
            select: { id: true, voidsTransactionId: true, amountCents: true, roundId: true },
          });
          const contribution = await adminOverview(body.poolSeasonId, prepared.transaction.roundId, tx);
          const event = await eventForContribution(tx, body, context.idempotencyKey);
          return {
            before,
            after: contribution,
            result: { contribution, eventId: event.id, voided },
            affectedCount: 1,
            details: { action: body.action, transactionId: body.transactionId },
          };
        }
        const prepared = await prepareAccount(body, tx);
        const before = await adminOverview(body.poolSeasonId, undefined, tx);
        if (!prepared.membership) {
          await tx.poolSeasonMembership.upsert({
            where: {
              poolSeasonId_userId: { poolSeasonId: body.poolSeasonId, userId: body.userId },
            },
            create: {
              poolSeasonId: body.poolSeasonId,
              userId: body.userId,
              status: 'INACTIVE',
            },
            update: {},
          });
        }
        const account = await tx.poolSeasonContributionAccount.upsert({
          where: {
            poolSeasonId_userId: { poolSeasonId: body.poolSeasonId, userId: body.userId },
          },
          create: {
            poolSeasonId: body.poolSeasonId,
            userId: body.userId,
            startRound: prepared.startRound,
            endRound: prepared.endRound,
          },
          update: {
            startRound: prepared.startRound,
            endRound: prepared.endRound,
          },
          select: { id: true, userId: true, startRound: true, endRound: true },
        });
        const contribution = await adminOverview(body.poolSeasonId, undefined, tx);
        const event = await eventForContribution(tx, body, context.idempotencyKey);
        return {
          before,
          after: contribution,
          result: { contribution, eventId: event.id, account },
          affectedCount: prepared.membership ? 1 : 2,
          details: { action: body.action, userId: body.userId },
        };
      },
    });
    await dispatchOutboxEvent(response.result.eventId);
    res.json({
      contribution: response.result.contribution,
      mutation: {
        ...(response.result.payment ? { payment: response.result.payment } : {}),
        ...(response.result.voided ? { voided: response.result.voided } : {}),
        ...(response.result.account ? { account: response.result.account } : {}),
      },
      affectedCount: response.affectedCount,
      replayed: response.replayed,
    });
  }),
);
