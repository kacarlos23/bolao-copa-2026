import {
  seasonTeamSummaryDtoSchema,
  teamProfileDtoSchema,
  type PaginationQuery,
} from '@bolao/shared';
import { AppError } from '../../http/errors.js';
import { paginationArgs, paginationMeta } from '../shared/pagination.js';
import { getSeason } from '../seasons/season.use-cases.js';
import { findSeasonTeamProfile, listSeasonTeamProfiles } from './team.repository.js';

function externalId(value: string) {
  return value.startsWith('team:') ? value.slice('team:'.length) : value;
}

export async function listSeasonTeams(seasonId: string, query: PaginationQuery) {
  await getSeason(seasonId);
  const { entries, total, mappings } = await listSeasonTeamProfiles(
    seasonId,
    paginationArgs(query),
  );
  const mappingByTeam = new Map(
    mappings.map((mapping) => [mapping.internalId, mapping.externalId]),
  );
  return {
    teams: entries.map(({ team }) => {
      const snapshot = team.profileSnapshots[0];
      return seasonTeamSummaryDtoSchema.parse({
        team: {
          id: team.id,
          name: team.name,
          code: team.code,
          flagUrl: team.flagUrl,
          crestUrl: team.crestUrl,
        },
        externalId: snapshot?.externalTeamId ?? externalId(mappingByTeam.get(team.id) ?? team.id),
        state: snapshot?.state ?? null,
        profileAvailable: Boolean(snapshot),
        collectedAt: snapshot?.collectedAt.toISOString() ?? null,
      });
    }),
    pagination: paginationMeta(query, total),
  };
}

export async function getTeamProfile(seasonId: string, teamId: string) {
  await getSeason(seasonId);
  const entry = await findSeasonTeamProfile(seasonId, teamId);
  if (!entry) throw new AppError(404, 'Time não encontrado nesta temporada.', 'TEAM_NOT_FOUND');
  const snapshot = entry.team.profileSnapshots[0];
  if (!snapshot) {
    throw new AppError(
      404,
      'O perfil oficial deste time ainda não foi importado.',
      'TEAM_PROFILE_NOT_IMPORTED',
    );
  }
  return teamProfileDtoSchema.parse({
    seasonId,
    team: {
      id: entry.team.id,
      name: entry.team.name,
      code: entry.team.code,
      flagUrl: entry.team.flagUrl,
      crestUrl: entry.team.crestUrl,
    },
    externalId: snapshot.externalTeamId,
    state: snapshot.state,
    athletes: snapshot.athletes,
    matches: snapshot.matches,
    statistics: snapshot.statistics,
    source: {
      provider: 'CBF',
      label: 'Confederação Brasileira de Futebol',
      url: snapshot.sourceUrl,
      collectedAt: snapshot.collectedAt.toISOString(),
      checksum: snapshot.checksum,
    },
  });
}
