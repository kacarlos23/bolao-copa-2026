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
  fundraisingAmountCentsSchema,
  fundraisingDto,
  getPoolSeasonFundraising,
} from './fundraising.service.js';

export const publicFundraisingRouter = Router();
export const adminFundraisingRouter = Router();

publicFundraisingRouter.use(requireAuth);
adminFundraisingRouter.use(requireAdmin);

const publicParamsSchema = z
  .object({
    poolSlug: z.string().trim().min(1).max(100),
    seasonId: entityIdSchema,
  })
  .strict();

const fundraisingInputSchema = z
  .object({
    seasonId: entityIdSchema,
    poolSeasonId: entityIdSchema,
    amountCents: fundraisingAmountCentsSchema,
    justification: justificationSchema,
  })
  .strict();

async function fundraisingImpact(input: { seasonId: string; poolSeasonId: string }) {
  const poolSeason = await prisma.poolSeason.findFirst({
    where: { id: input.poolSeasonId, seasonId: input.seasonId },
    select: {
      id: true,
      poolId: true,
      seasonId: true,
      scoreableFromRound: true,
      startsAtRound: true,
      fundraising: {
        select: {
          amountCents: true,
          updatedAt: true,
          updatedById: true,
          lastJustification: true,
        },
      },
      pool: {
        select: {
          name: true,
          memberships: {
            where: { status: 'ACTIVE', user: { status: 'ACTIVE' } },
            select: { id: true },
          },
        },
      },
      season: { select: { name: true } },
    },
  });
  if (!poolSeason) {
    throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
  }
  const gateRound = Math.max(poolSeason.startsAtRound ?? 0, poolSeason.scoreableFromRound ?? 0);
  const eligibleMatches = await prisma.match.count({
    where: {
      seasonId: poolSeason.seasonId,
      ...(gateRound > 0 ? { round: { order: { gte: gateRound } } } : {}),
    },
  });
  return {
    poolSeason,
    eligibleMatches,
    activeParticipants: poolSeason.pool.memberships.length,
    estimatedContributionCents: poolSeason.pool.memberships.length * eligibleMatches * 100,
  };
}

publicFundraisingRouter.get(
  '/:poolSlug/seasons/:seasonId/fundraising',
  asyncHandler(async (req, res) => {
    const params = publicParamsSchema.parse(req.params);
    res.locals.poolSlug = params.poolSlug;
    res.locals.seasonId = params.seasonId;
    const context = await resolvePoolSeasonContext({
      ...params,
      userId: req.session.user!.id,
    });
    await assertCompetitionFeature(context.seasonId, 'read', req.session.user!.role);
    res.locals.poolSeasonId = context.poolSeasonId;
    res.json({
      fundraising: await getPoolSeasonFundraising(context.poolSeasonId),
    });
  }),
);

adminFundraisingRouter.get(
  '/fundraising',
  asyncHandler(async (req, res) => {
    const query = fundraisingInputSchema
      .pick({ seasonId: true, poolSeasonId: true })
      .parse(req.query);
    setAdminScope(req, query);
    const impact = await fundraisingImpact(query);
    res.json({
      fundraising: fundraisingDto(query.poolSeasonId, impact.poolSeason.fundraising),
      eligibleMatches: impact.eligibleMatches,
      activeParticipants: impact.activeParticipants,
      estimatedContributionCents: impact.estimatedContributionCents,
    });
  }),
);

adminFundraisingRouter.post(
  '/fundraising/preview',
  asyncHandler(async (req, res) => {
    const body = fundraisingInputSchema.parse(req.body);
    setAdminScope(req, body);
    const impact = await fundraisingImpact(body);
    res.json(
      await createAdminPreview({
        context: adminRequestContext(req),
        action: 'FUNDRAISING_CHANGE',
        scope: {
          targetType: 'PoolSeasonFundraising',
          targetId: body.poolSeasonId,
          seasonId: body.seasonId,
          poolSeasonId: body.poolSeasonId,
        },
        justification: body.justification,
        request: { amountCents: body.amountCents },
        preview: {
          season: impact.poolSeason.season.name,
          pool: impact.poolSeason.pool.name,
          before: fundraisingDto(body.poolSeasonId, impact.poolSeason.fundraising),
          after: { amountCents: body.amountCents },
          activeParticipants: impact.activeParticipants,
          eligibleMatches: impact.eligibleMatches,
          estimatedContributionCents: impact.estimatedContributionCents,
        },
        affectedCount: 1,
      }),
    );
  }),
);

adminFundraisingRouter.put(
  '/fundraising',
  asyncHandler(async (req, res) => {
    const body = fundraisingInputSchema
      .extend(reinforcedConfirmationSchema.shape)
      .strict()
      .parse(req.body);
    setAdminScope(req, body);
    const context = adminRequestContext(req);
    const response = await executeSensitiveMutation({
      context,
      action: 'FUNDRAISING_UPDATED',
      operation: 'FUNDRAISING_CHANGE',
      scope: {
        targetType: 'PoolSeasonFundraising',
        targetId: body.poolSeasonId,
        seasonId: body.seasonId,
        poolSeasonId: body.poolSeasonId,
      },
      justification: body.justification,
      request: { amountCents: body.amountCents },
      confirmation: body,
      mutate: async (tx) => {
        const poolSeason = await tx.poolSeason.findFirst({
          where: { id: body.poolSeasonId, seasonId: body.seasonId },
          select: {
            id: true,
            fundraising: {
              select: {
                amountCents: true,
                updatedAt: true,
                updatedById: true,
                lastJustification: true,
              },
            },
          },
        });
        if (!poolSeason) {
          throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
        }
        const before = fundraisingDto(body.poolSeasonId, poolSeason.fundraising);
        const stored = await tx.poolSeasonFundraising.upsert({
          where: { poolSeasonId: body.poolSeasonId },
          create: {
            poolSeasonId: body.poolSeasonId,
            amountCents: body.amountCents,
            lastJustification: body.justification,
            updatedById: context.actorId,
          },
          update: {
            amountCents: body.amountCents,
            lastJustification: body.justification,
            updatedById: context.actorId,
          },
        });
        const fundraising = fundraisingDto(body.poolSeasonId, stored);
        const event = await enqueueOutboxEvent(tx, {
          type: 'fundraising.updated',
          seasonId: body.seasonId,
          poolSeasonId: body.poolSeasonId,
          payload: fundraising,
          idempotencyKey: `fundraising.updated:${context.idempotencyKey}`,
        });
        return {
          before,
          after: fundraising,
          result: { fundraising, eventId: event.id },
          affectedCount: 1,
          details: { amountCents: body.amountCents },
        };
      },
    });
    await dispatchOutboxEvent(response.result.eventId);
    res.json({
      fundraising: response.result.fundraising,
      affectedCount: response.affectedCount,
      replayed: response.replayed,
    });
  }),
);
