import { standingRowDtoSchema, type PaginationQuery } from '@bolao/shared';
import type { Prisma } from '@prisma/client';
import { getSeason } from '../seasons/season.use-cases.js';
import { paginationMeta } from '../shared/pagination.js';
import { loadSeasonStandingsData } from './standing.repository.js';
import { calculateStandings } from './standings.logic.js';

function jsonString(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value[key] === 'string' ? value[key] : null;
}

export async function getSeasonStandings(seasonId: string, query: PaginationQuery) {
  await getSeason(seasonId);
  const [seasonTeams, matches] = await loadSeasonStandingsData(seasonId);
  const groupByTeam = new Map(
    seasonTeams.map((entry) => [entry.team.id, entry.groupName ?? 'Sem grupo']),
  );
  const standings = calculateStandings(
    seasonTeams.map((entry) => ({
      group: entry.groupName ?? 'Sem grupo',
      team: entry.team,
    })),
    matches.map((match) => ({
      group:
        jsonString(match.rawPayload, 'group') ?? groupByTeam.get(match.homeTeamId) ?? 'Sem grupo',
      status: match.status,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeScore:
        match.status === 'FINISHED' ? (match.finalHomeScore ?? match.homeScore) : match.homeScore,
      awayScore:
        match.status === 'FINISHED' ? (match.finalAwayScore ?? match.awayScore) : match.awayScore,
    })),
  );

  const flat = standings.flatMap((group) => group.rows);
  const start = (query.page - 1) * query.pageSize;
  const pagedIds = new Set(flat.slice(start, start + query.pageSize).map((row) => `${row.group}:${row.team.id}`));
  return {
    standingsByGroup: standings
      .map((group) => ({
        group: group.group,
        rows: group.rows
          .filter((row) => pagedIds.has(`${row.group}:${row.team.id}`))
          .map((row) => standingRowDtoSchema.parse(row)),
      }))
      .filter((group) => group.rows.length > 0),
    pagination: paginationMeta(query, flat.length),
  };
}
