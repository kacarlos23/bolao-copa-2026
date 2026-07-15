import {
  rankingAwardDtoSchema,
  rankingRowDtoSchema,
  type PaginationQuery,
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
  query: PaginationQuery,
) {
  const ranking = (await getRanking(period, context)).map((row) => rankingRowDtoSchema.parse(row));
  const start = (query.page - 1) * query.pageSize;
  return {
    ranking: ranking.slice(start, start + query.pageSize),
    pagination: paginationMeta(query, ranking.length),
  };
}

export async function getPoolRankingAwards(context: RankingContext) {
  return (await getRankingAwards(context)).map((award) => rankingAwardDtoSchema.parse(award));
}
