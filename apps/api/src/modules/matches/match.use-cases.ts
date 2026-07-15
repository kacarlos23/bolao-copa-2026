import { matchDtoSchema, type PaginationQuery } from '@bolao/shared';
import type { MatchStatus } from '@prisma/client';
import { getSeason } from '../seasons/season.use-cases.js';
import { assertRoundInSeason } from '../rounds/round.use-cases.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { listSeasonMatchRecords } from './match.repository.js';

export interface ListMatchesInput extends PaginationQuery {
  roundId?: string;
  status?: MatchStatus;
  from?: string;
  to?: string;
}

export async function listSeasonMatches(seasonId: string, input: ListMatchesInput) {
  await getSeason(seasonId);
  if (input.roundId) await assertRoundInSeason(input.roundId, seasonId);
  const filters = {
    roundId: input.roundId,
    status: input.status,
    from: input.from ? new Date(input.from) : undefined,
    to: input.to ? new Date(input.to) : undefined,
  };
  const [matches, total] = await listSeasonMatchRecords(
    seasonId,
    filters,
    paginationArgs(input),
  );
  return {
    matches: matches.map((match) =>
      matchDtoSchema.parse({
        ...match,
        seasonId: match.seasonId,
        startsAt: match.startsAt.toISOString(),
        predictionClosesAt: match.predictionClosesAt?.toISOString() ?? null,
      }),
    ),
    pagination: paginationMeta(input, total),
  };
}
