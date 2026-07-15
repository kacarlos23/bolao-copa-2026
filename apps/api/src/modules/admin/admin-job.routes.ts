import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/async-handler.js';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import {
  adminRequestContext, createAdminPreview, executeSensitiveMutation, justificationSchema,
  reinforcedConfirmationSchema, setAdminScope,
} from './admin-security.js';

export const adminJobRouter = Router();

const reprocessSchema = z.object({
  seasonId: z.string().min(1).max(200), poolSeasonId: z.string().min(1).max(200),
  ruleSetVersionId: z.string().min(1).max(200),
  targets: z.array(z.enum(['SCORES', 'RANKING', 'ACHIEVEMENTS'])).min(1).max(3).transform((items) => [...new Set(items)]),
  justification: justificationSchema,
}).strict();

async function reprocessImpact(body: z.infer<typeof reprocessSchema>) {
  const pool = await prisma.poolSeason.findFirst({ where: { id: body.poolSeasonId, seasonId: body.seasonId }, select: { id: true, scoringRuleSetVersionId: true } });
  if (!pool) throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
  if (pool.scoringRuleSetVersionId !== body.ruleSetVersionId) throw new AppError(409, 'ruleSetVersion diverge da versão fixada no PoolSeason.', 'RULE_SET_VERSION_MISMATCH');
  const [matches, scores, snapshots, achievements] = await Promise.all([
    prisma.match.count({ where: { seasonId: body.seasonId, predictions: { some: { poolSeasonId: body.poolSeasonId } } } }),
    prisma.predictionScore.count({ where: { poolSeasonId: body.poolSeasonId } }),
    prisma.rankingSnapshot.count({ where: { seasonId: body.seasonId, poolSeasonId: body.poolSeasonId } }),
    prisma.userAchievement.count({ where: { poolSeasonId: body.poolSeasonId } }),
  ]);
  const counts = { matches, scores, snapshots, achievements };
  const affectedCount = (body.targets.includes('SCORES') ? matches + scores : 0) + (body.targets.includes('RANKING') ? snapshots : 0) + (body.targets.includes('ACHIEVEMENTS') ? achievements : 0);
  return { counts, affectedCount };
}

adminJobRouter.post('/reprocess/preview', asyncHandler(async (req, res) => {
  const body = reprocessSchema.parse(req.body); setAdminScope(req, body);
  const impact = await reprocessImpact(body);
  res.json(await createAdminPreview({
    context: adminRequestContext(req), action: 'REPROCESS_POOL_SEASON',
    scope: { targetType: 'PoolSeason', targetId: body.poolSeasonId, seasonId: body.seasonId, poolSeasonId: body.poolSeasonId },
    justification: body.justification, request: { targets: body.targets, ruleSetVersionId: body.ruleSetVersionId },
    preview: { targets: body.targets, ruleSetVersionId: body.ruleSetVersionId, counts: impact.counts, rollback: 'Restaurar backup ou reexecutar com a mesma ruleSetVersion; os writes internos são idempotentes.' },
    affectedCount: impact.affectedCount, ttlMinutes: 10,
  }));
}));

adminJobRouter.post('/reprocess', asyncHandler(async (req, res) => {
  const body = reprocessSchema.extend(reinforcedConfirmationSchema.shape).strict().parse(req.body); setAdminScope(req, body);
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'JOB_QUEUED', operation: 'REPROCESS_POOL_SEASON',
    scope: { targetType: 'PoolSeason', targetId: body.poolSeasonId, seasonId: body.seasonId, poolSeasonId: body.poolSeasonId },
    justification: body.justification, request: { targets: body.targets, ruleSetVersionId: body.ruleSetVersionId }, confirmation: body,
    mutate: async (tx) => {
      const pool = await tx.poolSeason.findFirst({ where: { id: body.poolSeasonId, seasonId: body.seasonId } });
      if (!pool) throw new AppError(400, 'PoolSeason não pertence à temporada.', 'POOL_SEASON_MISMATCH');
      if (pool.scoringRuleSetVersionId !== body.ruleSetVersionId) throw new AppError(409, 'ruleSetVersion mudou após a prévia.', 'RULE_SET_VERSION_MISMATCH');
      const preview = await tx.adminOperation.findUniqueOrThrow({ where: { id: body.previewId } });
      const job = await tx.adminJob.create({ data: {
        type: 'REPROCESS_POOL_SEASON', seasonId: body.seasonId, poolSeasonId: body.poolSeasonId,
        ruleSetVersionId: body.ruleSetVersionId, requestedById: req.session.user!.id,
        requestId: String(res.locals.requestId), justification: body.justification,
        idempotencyKey: adminRequestContext(req).idempotencyKey,
        payload: { targets: body.targets }, preview: preview.preview ?? {}, affectedCount: preview.affectedCount,
      } });
      return { before: { job: null }, after: job, result: job, affectedCount: preview.affectedCount };
    },
  });
  res.status(202).json(response);
}));

const jobActionSchema = z.object({ justification: justificationSchema }).strict();

adminJobRouter.post('/jobs/:jobId/pause', asyncHandler(async (req, res) => {
  const body = jobActionSchema.parse(req.body);
  const existing = await prisma.adminJob.findUnique({ where: { id: req.params.jobId } });
  if (!existing) throw new AppError(404, 'Job não encontrado.', 'JOB_NOT_FOUND');
  setAdminScope(req, existing);
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'JOB_PAUSED', operation: 'ADMIN_JOB_PAUSE',
    scope: { targetType: 'AdminJob', targetId: existing.id, seasonId: existing.seasonId, poolSeasonId: existing.poolSeasonId },
    justification: body.justification, request: body,
    mutate: async (tx) => {
      const before = await tx.adminJob.findUniqueOrThrow({ where: { id: existing.id } });
      if (!['QUEUED', 'RUNNING'].includes(before.status)) throw new AppError(409, 'Somente jobs pendentes ou em execução podem ser pausados.', 'JOB_NOT_PAUSABLE');
      const after = await tx.adminJob.update({ where: { id: before.id }, data: before.status === 'QUEUED' ? { status: 'PAUSED', pauseRequested: true } : { pauseRequested: true } });
      return { before, after, result: after, affectedCount: 1 };
    },
  }); res.json(response);
}));

adminJobRouter.post('/jobs/:jobId/retry', asyncHandler(async (req, res) => {
  const body = jobActionSchema.parse(req.body);
  const existing = await prisma.adminJob.findUnique({ where: { id: req.params.jobId } });
  if (!existing) throw new AppError(404, 'Job não encontrado.', 'JOB_NOT_FOUND');
  setAdminScope(req, existing);
  const response = await executeSensitiveMutation({
    context: adminRequestContext(req), action: 'JOB_RETRIED', operation: 'ADMIN_JOB_RETRY',
    scope: { targetType: 'AdminJob', targetId: existing.id, seasonId: existing.seasonId, poolSeasonId: existing.poolSeasonId },
    justification: body.justification, request: body,
    mutate: async (tx) => {
      const before = await tx.adminJob.findUniqueOrThrow({ where: { id: existing.id } });
      if (!['FAILED', 'PAUSED'].includes(before.status) || before.attempts >= before.maxAttempts) throw new AppError(409, 'Job não pode ser reexecutado com segurança.', 'JOB_NOT_RETRYABLE');
      const after = await tx.adminJob.update({ where: { id: before.id }, data: { status: 'QUEUED', pauseRequested: false, processedCount: 0, startedAt: null, finishedAt: null, errorCode: null, errorMessage: null } });
      return { before, after, result: after, affectedCount: before.affectedCount };
    },
  }); res.status(202).json(response);
}));
