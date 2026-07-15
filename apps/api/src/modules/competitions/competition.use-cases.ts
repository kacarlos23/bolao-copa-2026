import { competitionDtoSchema, type PaginationQuery } from '@bolao/shared';
import { AppError } from '../../http/errors.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { listSeasons } from '../seasons/season.use-cases.js';
import { findCompetitionBySlug, listCompetitionRecords } from './competition.repository.js';

export async function listCompetitions(query: PaginationQuery) {
  const [competitions, total] = await listCompetitionRecords(paginationArgs(query));
  return {
    competitions: competitions.map((competition) => competitionDtoSchema.parse(competition)),
    pagination: paginationMeta(query, total),
  };
}

export async function listSeasonsByCompetitionSlug(slug: string, query: PaginationQuery) {
  const competition = await findCompetitionBySlug(slug);
  if (!competition) {
    throw new AppError(404, 'Competição não encontrada.', 'COMPETITION_NOT_FOUND');
  }
  return {
    competition: competitionDtoSchema.parse(competition),
    ...(await listSeasons(competition.id, query)),
  };
}
