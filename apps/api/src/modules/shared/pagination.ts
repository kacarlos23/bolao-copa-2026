import type { Pagination, PaginationQuery } from '@bolao/shared';

export function paginationArgs(input: PaginationQuery) {
  return { skip: (input.page - 1) * input.pageSize, take: input.pageSize };
}

export function paginationMeta(input: PaginationQuery, total: number): Pagination {
  return {
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
  };
}
