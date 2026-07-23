import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { recomputePoolSeasonEngagement } from '../engagement/engagement.service.js';
import { recalculateScoresForMatch, refreshRankingSnapshot } from '../../services/ranking.service.js';
import { redactProviderError } from '../providers/provider-utils.js';

type ReprocessPayload = { targets: Array<'SCORES' | 'RANKING' | 'ACHIEVEMENTS'> };

function payload(value: Prisma.JsonValue): ReprocessPayload {
  const targets = (value as { targets?: unknown })?.targets;
  return { targets: Array.isArray(targets) ? targets.filter((item): item is ReprocessPayload['targets'][number] => ['SCORES', 'RANKING', 'ACHIEVEMENTS'].includes(String(item))) : [] };
}

export async function runNextAdminJob() {
  const candidate = await prisma.adminJob.findFirst({ where: { status: 'QUEUED', pauseRequested: false }, orderBy: { createdAt: 'asc' } });
  if (!candidate) return false;
  const claimed = await prisma.adminJob.updateMany({
    where: { id: candidate.id, status: 'QUEUED', pauseRequested: false },
    data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 }, errorCode: null, errorMessage: null },
  });
  if (claimed.count !== 1) return true;
  try {
    const job = await prisma.adminJob.findUniqueOrThrow({ where: { id: candidate.id } });
    const poolSeason = job.poolSeasonId ? await prisma.poolSeason.findFirst({
      where: { id: job.poolSeasonId, seasonId: job.seasonId }, select: { id: true, poolId: true, seasonId: true, scoringRuleSetVersionId: true },
    }) : null;
    if (!poolSeason) throw new Error('POOL_SEASON_MISMATCH');
    if (poolSeason.scoringRuleSetVersionId !== job.ruleSetVersionId) throw new Error('RULE_SET_VERSION_CHANGED');
    const plan = payload(job.payload);
    let processed = 0;
    if (plan.targets.includes('SCORES')) {
      const matches = await prisma.match.findMany({
        where: { seasonId: job.seasonId, predictions: { some: { poolSeasonId: poolSeason.id } } }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }], select: { id: true },
      });
      for (const match of matches) {
        const state = await prisma.adminJob.findUnique({ where: { id: job.id }, select: { pauseRequested: true } });
        if (state?.pauseRequested) {
          await prisma.adminJob.update({ where: { id: job.id }, data: { status: 'PAUSED', processedCount: processed } });
          return true;
        }
        await recalculateScoresForMatch(match.id, { refreshRanking: false, poolSeasonId: poolSeason.id });
        processed += 1;
        await prisma.adminJob.update({ where: { id: job.id }, data: { processedCount: processed } });
      }
    }
    if (plan.targets.includes('RANKING')) {
      await refreshRankingSnapshot({ seasonId: poolSeason.seasonId, poolId: poolSeason.poolId, poolSeasonId: poolSeason.id });
      processed += 1;
    }
    if (plan.targets.includes('ACHIEVEMENTS')) {
      await recomputePoolSeasonEngagement(poolSeason.id);
      processed += 1;
    }
    await prisma.adminJob.update({
      where: { id: job.id },
      data: { status: 'SUCCEEDED', processedCount: processed, finishedAt: new Date(), result: { processed, targets: plan.targets } },
    });
  } catch (error) {
    const message = redactProviderError(error);
    const errorCode = error instanceof Error ? error.name.slice(0, 100) : 'UNKNOWN';
    await prisma.adminJob.update({
      where: { id: candidate.id }, data: { status: 'FAILED', finishedAt: new Date(), errorCode, errorMessage: message },
    });
    logger.error(
      {
        errorCode,
        errorMessage: message,
        jobId: candidate.id,
      },
      'admin job failed',
    );
  }
  return true;
}
