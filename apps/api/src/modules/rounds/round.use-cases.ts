import { roundDtoSchema, type PaginationQuery } from '@bolao/shared';
import { AppError } from '../../http/errors.js';
import { getSeason } from '../seasons/season.use-cases.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { findRoundInSeason, listSeasonRoundRecords } from './round.repository.js';

export async function assertRoundInSeason(roundId: string, seasonId: string) {
  const round = await findRoundInSeason(roundId, seasonId);
  if (!round) {
    throw new AppError(400, 'Rodada não pertence à temporada.', 'ROUND_SEASON_MISMATCH');
  }
}

export async function listSeasonRounds(seasonId: string, query: PaginationQuery) {
  await getSeason(seasonId);
  const [rounds, total] = await listSeasonRoundRecords(seasonId, paginationArgs(query));
  return {
    rounds: rounds.map((round) =>
      roundDtoSchema.parse({
        ...round,
        startsAt: round.startsAt?.toISOString() ?? null,
        endsAt: round.endsAt?.toISOString() ?? null,
      }),
    ),
    pagination: paginationMeta(query, total),
  };
}
