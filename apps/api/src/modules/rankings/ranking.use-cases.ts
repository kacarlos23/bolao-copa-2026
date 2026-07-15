import {
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

export async function getPoolRanking(
  context: RankingContext,
  period: RankingPeriod,
  query: PaginationQuery & Partial<RankingQuery>,
) {
  const selection =
    query.scope === 'round' && query.roundId
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
