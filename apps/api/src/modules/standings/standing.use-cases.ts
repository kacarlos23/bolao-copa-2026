import { standingRowDtoSchema, type StandingsQuery } from '@bolao/shared';
import type { Prisma } from '@prisma/client';
import { paginationMeta } from '../shared/pagination.js';
import { loadSeasonStandingsData } from './standing.repository.js';
import { calculateStandings } from './standings.logic.js';
import { getSeasonRuntimeConfig } from '../providers/season-runtime-config.js';

function jsonString(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return typeof value[key] === 'string' ? value[key] : null;
}

function providerResultNumber(value: Prisma.JsonValue | null, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = value.providerResult;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined;
  return typeof result[key] === 'number' ? result[key] : undefined;
}

export async function getSeasonStandings(seasonId: string, query: StandingsQuery) {
  const [[seasonTeams, matches], runtime] = await Promise.all([
    loadSeasonStandingsData(seasonId),
    getSeasonRuntimeConfig(seasonId),
  ]);
  const groupByTeam = new Map(
    seasonTeams.map((entry) => [entry.team.id, entry.groupName ?? 'Sem grupo']),
  );
  const participants = seasonTeams.map((entry) => ({
    group: entry.groupName ?? 'Sem grupo',
    team: entry.team,
  }));
  const standingMatches = matches.map((match) => ({
      group:
        jsonString(match.rawPayload, 'group') ?? groupByTeam.get(match.homeTeamId) ?? 'Sem grupo',
      status: match.status,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      homeScore:
        match.status === 'FINISHED' ? (match.finalHomeScore ?? match.homeScore) : match.homeScore,
      awayScore:
        match.status === 'FINISHED' ? (match.finalAwayScore ?? match.awayScore) : match.awayScore,
      homeYellowCards: providerResultNumber(match.rawPayload, 'homeYellowCards'),
      awayYellowCards: providerResultNumber(match.rawPayload, 'awayYellowCards'),
      homeRedCards: providerResultNumber(match.rawPayload, 'homeRedCards'),
      awayRedCards: providerResultNumber(match.rawPayload, 'awayRedCards'),
  }));
  const standings = calculateStandings(participants, standingMatches, {
    ruleSet: runtime.standingsRule,
    venue: query.venue,
  });
  const overallRanks = new Map(
    calculateStandings(participants, standingMatches, { ruleSet: runtime.standingsRule })
      .flatMap((group) => group.rows.map((row) => [`${group.group}:${row.team.id}`, row.rank] as const)),
  );

  const flat = standings.flatMap((group) => group.rows);
  const upcomingByTeam = new Map<string, (typeof matches)[number]['homeTeam']>();
  for (const match of matches) {
    if (match.status !== 'SCHEDULED' && match.status !== 'LIVE') continue;
    if (!upcomingByTeam.has(match.homeTeamId)) upcomingByTeam.set(match.homeTeamId, match.awayTeam);
    if (!upcomingByTeam.has(match.awayTeamId)) upcomingByTeam.set(match.awayTeamId, match.homeTeam);
  }
  const start = (query.page - 1) * query.pageSize;
  const pagedIds = new Set(flat.slice(start, start + query.pageSize).map((row) => `${row.group}:${row.team.id}`));
  return {
    standingsByGroup: standings
      .map((group) => ({
        group: group.group,
        rows: group.rows
          .filter((row) => pagedIds.has(`${row.group}:${row.team.id}`))
          .map((row) =>
            standingRowDtoSchema.parse({
              ...row,
              overallRank: overallRanks.get(`${row.group}:${row.team.id}`) ?? row.rank,
              nextOpponent: upcomingByTeam.get(row.team.id) ?? null,
            }),
          ),
      }))
      .filter((group) => group.rows.length > 0),
    pagination: paginationMeta(query, flat.length),
  };
}
