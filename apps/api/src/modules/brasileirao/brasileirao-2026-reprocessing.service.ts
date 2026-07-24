import { BRASILEIRAO_2026_SCORING_RULE_SET } from '@bolao/shared';
import { prisma } from '../../prisma.js';
import { recomputePoolSeasonEngagement } from '../engagement/engagement.service.js';
import { stableHash } from '../scoring/scoring-rules.service.js';
import {
  recalculateScoresForMatch,
  refreshRankingSnapshot,
} from '../../services/ranking.service.js';
import {
  BRASILEIRAO_2026_POOL_SLUG,
  BRASILEIRAO_2026_SEASON_SLUG,
  BRASILEIRAO_2026_STARTS_AT_ROUND,
  BRASILEIRAO_COMPETITION_SLUG,
} from './brasileirao-2026.service.js';

export interface Brasileirao2026ReprocessingInput {
  actorId?: string | null;
  requestId?: string;
  idempotencyKey?: string;
  justification?: string;
}

export async function reprocessBrasileirao2026Ranking(
  input: Brasileirao2026ReprocessingInput = {},
) {
  const idempotencyKey = input.idempotencyKey ?? 'brasileirao-2026-round-20-reprocessing-v1';
  const auditIdempotencyKey = `audit:${idempotencyKey}`;
  const replay = await prisma.adminAuditLog.findUnique({
    where: { idempotencyKey: auditIdempotencyKey },
  });
  if (replay) {
    return {
      replayed: true,
      poolSeasonId: replay.poolSeasonId!,
      seasonId: replay.seasonId!,
      auditId: replay.id,
      summary: replay.after,
    };
  }

  const season = await prisma.competitionSeason.findFirst({
    where: {
      slug: BRASILEIRAO_2026_SEASON_SLUG,
      competition: { slug: BRASILEIRAO_COMPETITION_SLUG },
    },
    select: {
      id: true,
      poolSeasons: {
        where: { pool: { slug: BRASILEIRAO_2026_POOL_SLUG } },
        select: {
          id: true,
          poolId: true,
          scoreableFromRound: true,
          scoreableFrom: true,
          startsAtRound: true,
          historicalMatchesScoreable: true,
          scoringRuleSetVersionId: true,
        },
      },
    },
  });
  const poolSeason = season?.poolSeasons[0];
  if (!season || !poolSeason) {
    throw new Error('Brasileirão Série A 2026 PoolSeason not found.');
  }
  if (
    poolSeason.scoreableFromRound !== BRASILEIRAO_2026_STARTS_AT_ROUND ||
    poolSeason.startsAtRound !== BRASILEIRAO_2026_STARTS_AT_ROUND ||
    poolSeason.scoreableFrom !== null ||
    poolSeason.historicalMatchesScoreable ||
    poolSeason.scoringRuleSetVersionId !== BRASILEIRAO_2026_SCORING_RULE_SET.id
  ) {
    throw new Error('Brasileirão round-20 scoring policy is not configured.');
  }

  const context = {
    seasonId: season.id,
    poolId: poolSeason.poolId,
    poolSeasonId: poolSeason.id,
  };
  const before = await Promise.all([
    prisma.predictionScore.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.predictionScore.count({
      where: {
        poolSeasonId: poolSeason.id,
        match: { round: { order: { lt: BRASILEIRAO_2026_STARTS_AT_ROUND } } },
      },
    }),
    prisma.rankingSnapshot.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.rankingMovement.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.userAchievement.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.streak.count({ where: { poolSeasonId: poolSeason.id } }),
  ]);

  await prisma.$transaction(async (tx) => {
    await tx.rankingMovement.deleteMany({ where: { poolSeasonId: poolSeason.id } });
    await tx.rankingSnapshot.deleteMany({ where: { poolSeasonId: poolSeason.id } });
  });

  const matches = await prisma.match.findMany({
    where: {
      seasonId: season.id,
      predictions: { some: { poolSeasonId: poolSeason.id } },
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  for (const match of matches) {
    await recalculateScoresForMatch(match.id, {
      refreshRanking: false,
      poolSeasonId: poolSeason.id,
    });
  }

  await refreshRankingSnapshot(context);
  await recomputePoolSeasonEngagement(poolSeason.id);

  const afterValues = await Promise.all([
    prisma.predictionScore.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.predictionScore.count({
      where: {
        poolSeasonId: poolSeason.id,
        match: { round: { order: { lt: BRASILEIRAO_2026_STARTS_AT_ROUND } } },
      },
    }),
    prisma.rankingSnapshot.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.rankingMovement.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.userAchievement.count({ where: { poolSeasonId: poolSeason.id } }),
    prisma.streak.count({ where: { poolSeasonId: poolSeason.id } }),
  ]);
  const labels = [
    'scores',
    'ineligibleScores',
    'snapshots',
    'movements',
    'achievements',
    'streaks',
  ] as const;
  const beforeSummary = Object.fromEntries(labels.map((label, index) => [label, before[index]]));
  const afterSummary = Object.fromEntries(
    labels.map((label, index) => [label, afterValues[index]]),
  );
  const sourceRevision = stableHash({
    policy: 'brasileirao-2026-v3-round-20',
    scoringRuleSetVersionId: BRASILEIRAO_2026_SCORING_RULE_SET.id,
    matches: matches.map((match) => match.id),
    after: afterSummary,
  });
  const audit = await prisma.adminAuditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: 'RANKING_REPROCESSED',
      targetId: poolSeason.id,
      requestId: input.requestId ?? `cli:${idempotencyKey}`,
      seasonId: season.id,
      poolSeasonId: poolSeason.id,
      justification:
        input.justification ?? 'Reinício auditável do ranking do Brasileirão a partir da rodada 20',
      idempotencyKey: auditIdempotencyKey,
      origin: 'CLI reprocess:brasileirao-2026',
      before: beforeSummary,
      after: afterSummary,
      details: {
        sourceRevision,
        processedMatches: matches.length,
        scoreableFromRound: BRASILEIRAO_2026_STARTS_AT_ROUND,
        scoringRuleSetVersionId: BRASILEIRAO_2026_SCORING_RULE_SET.id,
      },
    },
  });
  return {
    replayed: false,
    poolSeasonId: poolSeason.id,
    seasonId: season.id,
    auditId: audit.id,
    summary: afterSummary,
  };
}
