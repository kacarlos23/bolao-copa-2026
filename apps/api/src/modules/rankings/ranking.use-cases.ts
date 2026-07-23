import {
  competitionCapabilitiesSchema,
  rankingAwardDtoSchema,
  rankingRowDtoSchema,
  type PaginationQuery,
  type RankingQuery,
} from '@bolao/shared';
import {
  getRanking,
  getRankingAwards,
  type RankingContext,
  type RankingPeriod,
} from '../../services/ranking.service.js';
import { paginationMeta } from '../shared/pagination.js';
import { prisma } from '../../prisma.js';
import { AppError } from '../../http/errors.js';

type DeclaredRankingScope = 'OVERALL' | 'STAGE' | 'ROUND' | 'MONTH' | 'TURN';

function declaredScope(query: Partial<RankingQuery>): DeclaredRankingScope {
  return query.scope === 'stage'
    ? 'STAGE'
    : query.scope === 'round'
      ? 'ROUND'
      : query.scope === 'month'
        ? 'MONTH'
        : query.scope === 'turn'
          ? 'TURN'
          : 'OVERALL';
}

export function enabledServerRankingScopes(capabilities: unknown) {
  const parsed = competitionCapabilitiesSchema.safeParse(capabilities);
  return new Set<DeclaredRankingScope>(
    parsed.success && parsed.data.rankingScopes ? parsed.data.rankingScopes : ['OVERALL'],
  );
}

async function assertRankingScope(context: RankingContext, query: Partial<RankingQuery>) {
  const scope = declaredScope(query);
  if (scope === 'OVERALL') return;
  const season = await prisma.competitionSeason.findUnique({
    where: { id: context.seasonId },
    select: { capabilities: true },
  });
  if (!season || !enabledServerRankingScopes(season.capabilities).has(scope)) {
    throw new AppError(
      400,
      `O escopo ${scope} não está habilitado para esta temporada.`,
      'RANKING_SCOPE_DISABLED',
    );
  }
  if (scope === 'STAGE' && query.stageId) {
    const stage = await prisma.stage.findFirst({
      where: { id: query.stageId, seasonId: context.seasonId },
      select: { id: true },
    });
    if (!stage) {
      throw new AppError(
        404,
        'Fase não encontrada nesta temporada.',
        'RANKING_SCOPE_OUT_OF_SEASON',
      );
    }
  }
  if (scope === 'ROUND' && query.roundId) {
    const round = await prisma.round.findFirst({
      where: { id: query.roundId, seasonId: context.seasonId },
      select: { id: true },
    });
    if (!round) {
      throw new AppError(
        404,
        'Rodada não encontrada nesta temporada.',
        'RANKING_SCOPE_OUT_OF_SEASON',
      );
    }
  }
}

export async function getPoolRanking(
  context: RankingContext,
  period: RankingPeriod,
  query: PaginationQuery & Partial<RankingQuery>,
) {
  await assertRankingScope(context, query);
  const selection =
    query.scope === 'stage' && query.stageId
      ? ({ scope: 'stage', stageId: query.stageId } as const)
      : query.scope === 'round' && query.roundId
        ? ({ scope: 'round', roundId: query.roundId } as const)
        : query.scope === 'month' && query.month
          ? ({ scope: 'month', month: query.month } as const)
          : query.scope === 'turn' && query.turn
            ? ({ scope: 'turn', turn: query.turn as 1 | 2 } as const)
            : ({ scope: 'overall' } as const);
  const ranking = (await getRanking(period, context, selection)).map((row) =>
    rankingRowDtoSchema.parse(row),
  );
  const start = (query.page - 1) * query.pageSize;
  return {
    ranking: ranking.slice(start, start + query.pageSize),
    pagination: paginationMeta(query, ranking.length),
  };
}

export async function getPoolRankingAwards(context: RankingContext) {
  return (await getRankingAwards(context)).map((award) => rankingAwardDtoSchema.parse(award));
}
