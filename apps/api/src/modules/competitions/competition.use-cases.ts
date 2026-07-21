import { competitionDtoSchema, type PaginationQuery } from '@bolao/shared';
import { AppError } from '../../http/errors.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { listSeasons } from '../seasons/season.use-cases.js';
import { publicCompetitionCapabilities } from './competition-capabilities.js';
import { findCompetitionBySlug, listCompetitionRecords } from './competition.repository.js';

function toCompetitionDto(
  competition: NonNullable<Awaited<ReturnType<typeof findCompetitionBySlug>>>,
) {
  return competitionDtoSchema.parse({
    id: competition.id,
    slug: competition.slug,
    name: competition.name,
    capabilities: publicCompetitionCapabilities(
      competition.capabilities,
      competition.metadata,
    ),
  });
}

export async function listCompetitions(query: PaginationQuery) {
  const [competitions, total] = await listCompetitionRecords(paginationArgs(query));
  return {
    competitions: competitions.map(toCompetitionDto),
    pagination: paginationMeta(query, total),
  };
}

export async function listSeasonsByCompetitionSlug(slug: string, query: PaginationQuery) {
  const competition = await findCompetitionBySlug(slug);
  if (!competition) {
    throw new AppError(404, 'Competição não encontrada.', 'COMPETITION_NOT_FOUND');
  }
  return {
    competition: toCompetitionDto(competition),
    ...(await listSeasons(competition.id, query)),
  };
}
