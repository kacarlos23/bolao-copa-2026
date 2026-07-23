import { Router } from 'express';
import { CompetitionSeasonStatus, RoundStatus, UserRole, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler.js';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { closeSseClientsForUser } from '../../realtime/sse.js';
import {
  adminRequestContext,
  createAdminPreview,
  executeSensitiveMutation,
  justificationSchema,
  reinforcedConfirmationSchema,
  setAdminScope,
} from './admin-security.js';
import {
  competitionFeatureKey,
  getCompetitionFeatureFlags,
  inspectCompetitionFeatureFlagsValue,
} from '../competitions/competition-feature.service.js';
import { assertCompetitionFeatureState } from '../competitions/competition-feature-policy.js';

export const adminResourceRouter = Router();

const seasonStatusInputSchema = z.object({
  status: z.nativeEnum(CompetitionSeasonStatus),
  justification: justificationSchema,
}).strict();

async function seasonImpact(seasonId: string) {
  const season = await prisma.competitionSeason.findUnique({
    where: { id: seasonId },
    select: {
      id: true, name: true, status: true,
      _count: { select: { matches: true, rounds: true, teams: true, poolSeasons: true } },
      poolSeasons: { select: { id: true, _count: { select: { predictions: true } } } },
    },
  });
  if (!season) throw new AppError(404, 'Temporada não encontrada.', 'SEASON_NOT_FOUND');
  const predictions = season.poolSeasons.reduce((total, pool) => total + pool._count.predictions, 0);
  return { season, affectedCount: season._count.matches + season._count.rounds + season._count.teams + predictions };
}

adminResourceRouter.post('/seasons/:seasonId/status/preview', asyncHandler(async (req, res) => {
  const body = seasonStatusInputSchema.parse(req.body);
  setAdminScope(req, { seasonId: req.params.seasonId });
  const impact = await seasonImpact(req.params.seasonId);
  const flags = await getCompetitionFeatureFlags(req.params.seasonId);
  const featureState = assertCompetitionFeatureState(body.status, flags);
  res.json(await createAdminPreview({
    context: adminRequestContext(req), action: 'SEASON_STATUS_CHANGE',
    scope: { targetType: 'CompetitionSeason', targetId: req.params.seasonId, seasonId: req.params.seasonId },
    justification: body.justification, request: { status: body.status },
    preview: {
      before: { status: impact.season.status, flags },
      after: { status: body.status, featureState },
      counts: impact.season._count,
      predictions: impact.season.poolSeasons,
    },
    affectedCount: impact.affectedCount,
  }));
}));

adminResourceRouter.patch('/seasons/:seasonId/status', asyncHandler(async (req, res) => {
  const body = seasonStatusInputSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body);
  setAdminScope(req, { seasonId: req.params.seasonId });
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'SEASON_UPDATED', operation: 'SEASON_STATUS_CHANGE',
    scope: { targetType: 'CompetitionSeason', targetId: req.params.seasonId, seasonId: req.params.seasonId },
    justification: body.justification, request: { status: body.status }, confirmation: body,
    mutate: async (tx) => {
      const before = await tx.competitionSeason.findUniqueOrThrow({ where: { id: req.params.seasonId } });
      const setting = await tx.appSetting.findUnique({
        where: { key: competitionFeatureKey(req.params.seasonId) },
      });
      const flags = inspectCompetitionFeatureFlagsValue(
        req.params.seasonId,
        setting?.value,
        before.status,
      ).flags;
      const featureState = assertCompetitionFeatureState(body.status, flags);
      const after = await tx.competitionSeason.update({ where: { id: before.id }, data: { status: body.status } });
      const affectedCount = await tx.match.count({ where: { seasonId: before.id } });
      return {
        before: { ...before, flags },
        after: { ...after, flags, featureState },
        result: after,
        affectedCount,
      };
    },
  });
  res.json(response);
}));

const roundStatusSchema = z.object({
  seasonId: z.string().min(1).max(200),
  status: z.nativeEnum(RoundStatus),
  predictionPolicy: z.enum(['KEEP', 'SUSPEND', 'REOPEN']).default('KEEP'),
  justification: justificationSchema,
}).strict();

adminResourceRouter.post('/rounds/:roundId/status/preview', asyncHandler(async (req, res) => {
  const body = roundStatusSchema.parse(req.body);
  setAdminScope(req, body);
  const round = await prisma.round.findFirst({
    where: { id: req.params.roundId, seasonId: body.seasonId },
    include: { matches: { select: { id: true, startsAt: true, predictionClosesAt: true, _count: { select: { predictions: true } } } } },
  });
  if (!round) throw new AppError(404, 'Rodada não encontrada na temporada.', 'ROUND_SEASON_MISMATCH');
  const predictionCount = round.matches.reduce((total, match) => total + match._count.predictions, 0);
  res.json(await createAdminPreview({
    context: adminRequestContext(req), action: 'ROUND_STATUS_CHANGE',
    scope: { targetType: 'Round', targetId: round.id, seasonId: body.seasonId },
    justification: body.justification, request: { status: body.status, predictionPolicy: body.predictionPolicy },
    preview: { before: { status: round.status }, after: { status: body.status, predictionPolicy: body.predictionPolicy }, matches: round.matches.length, predictions: predictionCount },
    affectedCount: round.matches.length + predictionCount,
  }));
}));

adminResourceRouter.patch('/rounds/:roundId/status', asyncHandler(async (req, res) => {
  const body = roundStatusSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body);
  setAdminScope(req, body);
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'ROUND_UPDATED', operation: 'ROUND_STATUS_CHANGE',
    scope: { targetType: 'Round', targetId: req.params.roundId, seasonId: body.seasonId },
    justification: body.justification, request: { status: body.status, predictionPolicy: body.predictionPolicy }, confirmation: body,
    mutate: async (tx) => {
      const before = await tx.round.findFirst({ where: { id: req.params.roundId, seasonId: body.seasonId } });
      if (!before) throw new AppError(404, 'Rodada não encontrada na temporada.', 'ROUND_SEASON_MISMATCH');
      const matchCount = await tx.match.count({ where: { roundId: before.id, seasonId: body.seasonId } });
      const after = await tx.round.update({ where: { id: before.id }, data: { status: body.status } });
      if (body.predictionPolicy === 'SUSPEND') {
        await tx.match.updateMany({ where: { roundId: before.id, seasonId: body.seasonId }, data: { predictionClosesAt: new Date(0) } });
      } else if (body.predictionPolicy === 'REOPEN') {
        const matches = await tx.match.findMany({ where: { roundId: before.id, seasonId: body.seasonId }, select: { id: true, startsAt: true } });
        for (const match of matches) {
          if (match.startsAt.getTime() > Date.now()) {
            await tx.match.update({ where: { id: match.id }, data: { predictionClosesAt: new Date(match.startsAt.getTime() - 5 * 60_000) } });
          }
        }
      }
      return { before, after: { ...after, predictionPolicy: body.predictionPolicy }, result: after, affectedCount: matchCount + 1 };
    },
  });
  res.json(response);
}));

adminResourceRouter.get('/rule-sets', asyncHandler(async (req, res) => {
  const query = z.object({ seasonId: z.string().min(1).max(200).optional() }).strict().parse(req.query);
  const [scoring, tieBreakers] = await Promise.all([
    prisma.scoringRuleSetVersion.findMany({ where: { OR: [{ seasonId: query.seasonId }, { seasonId: null }] }, orderBy: [{ key: 'asc' }, { version: 'desc' }] }),
    prisma.tieBreakerRuleSet.findMany({ where: { OR: [{ seasonId: query.seasonId }, { seasonId: null }] }, orderBy: [{ key: 'asc' }, { version: 'desc' }] }),
  ]);
  res.json({ scoring, tieBreakers });
}));

const ruleAssignmentSchema = z.object({
  seasonId: z.string().min(1).max(200), poolSeasonId: z.string().min(1).max(200),
  scoringRuleSetVersionId: z.string().min(1).max(200), tieBreakerRuleSetId: z.string().min(1).max(200),
  startsAtRound: z.number().int().min(1).max(100).nullable(), justification: justificationSchema,
}).strict();

async function ruleImpact(body: z.infer<typeof ruleAssignmentSchema>) {
  const pool = await prisma.poolSeason.findFirst({ where: { id: body.poolSeasonId, seasonId: body.seasonId }, include: { _count: { select: { predictions: true, predictionScores: true, rankingSnapshots: true } } } });
  if (!pool) throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
  const [scoring, tie] = await Promise.all([
    prisma.scoringRuleSetVersion.findFirst({ where: { id: body.scoringRuleSetVersionId, OR: [{ seasonId: body.seasonId }, { seasonId: null }] } }),
    prisma.tieBreakerRuleSet.findFirst({ where: { id: body.tieBreakerRuleSetId, OR: [{ seasonId: body.seasonId }, { seasonId: null }] } }),
  ]);
  if (!scoring || !tie) throw new AppError(400, 'Rule set não pertence à temporada.', 'RULE_SET_SEASON_MISMATCH');
  return { pool, scoring, tie, affectedCount: pool._count.predictions + pool._count.predictionScores + pool._count.rankingSnapshots };
}

adminResourceRouter.post('/rule-sets/assignment/preview', asyncHandler(async (req, res) => {
  const body = ruleAssignmentSchema.parse(req.body); setAdminScope(req, body);
  const impact = await ruleImpact(body);
  res.json(await createAdminPreview({
    context: adminRequestContext(req), action: 'RULE_SET_ASSIGNMENT',
    scope: { targetType: 'PoolSeason', targetId: body.poolSeasonId, seasonId: body.seasonId, poolSeasonId: body.poolSeasonId },
    justification: body.justification, request: { scoringRuleSetVersionId: body.scoringRuleSetVersionId, tieBreakerRuleSetId: body.tieBreakerRuleSetId, startsAtRound: body.startsAtRound },
    preview: { before: { scoringRuleSetVersionId: impact.pool.scoringRuleSetVersionId, tieBreakerRuleSetId: impact.pool.tieBreakerRuleSetId, startsAtRound: impact.pool.startsAtRound }, after: { scoringRuleSetVersionId: impact.scoring.id, tieBreakerRuleSetId: impact.tie.id, startsAtRound: body.startsAtRound }, counts: impact.pool._count },
    affectedCount: impact.affectedCount,
  }));
}));

adminResourceRouter.put('/rule-sets/assignment', asyncHandler(async (req, res) => {
  const body = ruleAssignmentSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body); setAdminScope(req, body);
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'RULE_SET_ASSIGNED', operation: 'RULE_SET_ASSIGNMENT',
    scope: { targetType: 'PoolSeason', targetId: body.poolSeasonId, seasonId: body.seasonId, poolSeasonId: body.poolSeasonId },
    justification: body.justification, request: { scoringRuleSetVersionId: body.scoringRuleSetVersionId, tieBreakerRuleSetId: body.tieBreakerRuleSetId, startsAtRound: body.startsAtRound }, confirmation: body,
    mutate: async (tx) => {
      const before = await tx.poolSeason.findFirst({ where: { id: body.poolSeasonId, seasonId: body.seasonId } });
      if (!before) throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
      const existingPredictions = await tx.prediction.count({ where: { poolSeasonId: body.poolSeasonId } });
      if (existingPredictions > 0) throw new AppError(409, 'Rule sets ficam imutáveis após o primeiro palpite.', 'RULE_SET_ALREADY_IN_USE');
      const after = await tx.poolSeason.update({ where: { id: body.poolSeasonId }, data: { scoringRuleSetVersionId: body.scoringRuleSetVersionId, tieBreakerRuleSetId: body.tieBreakerRuleSetId, startsAtRound: body.startsAtRound } });
      return { before, after, result: after, affectedCount: 1 };
    },
  });
  res.json(response);
}));

const userMutationSchema = z.object({
  role: z.nativeEnum(UserRole).optional(), status: z.nativeEnum(UserStatus).optional(),
  revokeSessions: z.boolean().default(true), justification: justificationSchema,
}).strict().refine((body) => body.role !== undefined || body.status !== undefined || body.revokeSessions, 'Informe uma alteração.');

adminResourceRouter.patch('/users/:userId/access', asyncHandler(async (req, res) => {
  const body = userMutationSchema.parse(req.body);
  if (req.params.userId === req.session.user!.id && (body.status === 'BLOCKED' || body.role === 'USER')) {
    throw new AppError(400, 'O administrador não pode bloquear ou rebaixar a própria sessão.', 'SELF_ACCESS_CHANGE_NOT_ALLOWED');
  }
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: body.role ? 'USER_ROLE_CHANGED' : body.status === 'BLOCKED' ? 'USER_BLOCKED' : body.status === 'ACTIVE' ? 'USER_UNBLOCKED' : 'USER_SESSION_REVOKED',
    operation: 'USER_ACCESS_CHANGE', scope: { targetType: 'User', targetId: req.params.userId },
    justification: body.justification, request: body,
    mutate: async (tx) => {
      const before = await tx.user.findUnique({ where: { id: req.params.userId }, select: { id: true, role: true, status: true, sessionVersion: true } });
      if (!before) throw new AppError(404, 'Usuário não encontrado.', 'USER_NOT_FOUND');
      const after = await tx.user.update({
        where: { id: before.id }, data: { role: body.role, status: body.status, ...(body.revokeSessions ? { sessionVersion: { increment: 1 } } : {}) },
        select: { id: true, username: true, nickname: true, avatarUrl: true, role: true, status: true, sessionVersion: true, createdAt: true, updatedAt: true },
      });
      return { before, after, result: after, affectedCount: 1, details: { membershipChanged: false } };
    },
  });
  closeSseClientsForUser(req.params.userId);
  res.json(response);
}));
