import { tieDtoSchema, type PaginationQuery, type TieStatus } from '@bolao/shared';
import { getSeason } from '../seasons/season.use-cases.js';
import { assertRoundInSeason } from '../rounds/round.use-cases.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { assertStageInSeason } from '../stages/stage.use-cases.js';
import { listSeasonTieRecords } from './tie.repository.js';

export interface ListTiesInput extends PaginationQuery {
  stageId?: string;
  roundId?: string;
  status?: TieStatus;
}

export async function listSeasonTies(seasonId: string, input: ListTiesInput) {
  await getSeason(seasonId);
  if (input.stageId) await assertStageInSeason(input.stageId, seasonId);
  if (input.roundId) await assertRoundInSeason(input.roundId, seasonId);
  const [ties, total] = await listSeasonTieRecords(
    seasonId,
    { stageId: input.stageId, roundId: input.roundId, status: input.status },
    paginationArgs(input),
  );
  return {
    ties: ties.map((tie) =>
      tieDtoSchema.parse({
        ...tie,
        decidedAt: tie.decidedAt?.toISOString() ?? null,
        lastRecomputedAt: tie.lastRecomputedAt?.toISOString() ?? null,
        matches: tie.matches.map((match) => ({
          ...match,
          seasonId: match.seasonId,
          startsAt: match.startsAt.toISOString(),
          predictionClosesAt: match.predictionClosesAt?.toISOString() ?? null,
        })),
      }),
    ),
    pagination: paginationMeta(input, total),
  };
}
