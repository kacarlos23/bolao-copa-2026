import { seasonDtoSchema, type PaginationQuery } from '@bolao/shared';
import { AppError } from '../../http/errors.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { findSeasonById, listCompetitionSeasons } from './season.repository.js';
import { publicCompetitionCapabilities } from '../competitions/competition-capabilities.js';

function toSeasonDto(season: NonNullable<Awaited<ReturnType<typeof findSeasonById>>>) {
  return seasonDtoSchema.parse({
    id: season.id,
    competitionId: season.competitionId,
    slug: season.slug,
    name: season.name,
    year: season.year,
    timezone: season.timezone,
    status: season.status,
    startsAt: season.startsAt?.toISOString() ?? null,
    endsAt: season.endsAt?.toISOString() ?? null,
    capabilities: publicCompetitionCapabilities(season.capabilities, season.metadata),
  });
}

export async function getSeason(seasonId: string) {
  const season = await findSeasonById(seasonId);
  if (!season) throw new AppError(404, 'Temporada não encontrada.', 'SEASON_NOT_FOUND');
  return toSeasonDto(season);
}

export async function listSeasons(competitionId: string, query: PaginationQuery) {
  const [seasons, total] = await listCompetitionSeasons(competitionId, paginationArgs(query));
  return {
    seasons: seasons.map(toSeasonDto),
    pagination: paginationMeta(query, total),
  };
}
