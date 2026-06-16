import { knockoutFixtureSeeds, type KnockoutFixtureSeed } from '../data/knockout-fixtures.js';
import { thirdPlaceMatrix, thirdPlaceMatrixColumns } from '../data/third-place-matrix.js';

export type ProjectionTeam = {
  id: string;
  name: string;
  code: string | null;
  fifaRank: number | null;
  flagUrl?: string | null;
  metadata?: unknown;
};

export type ProjectionMatch = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;
};

export type ProjectedStanding = {
  rank: number;
  team: ProjectionTeam;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

type MutableStanding = Omit<ProjectedStanding, 'rank'>;

export function scoreForProjection(match: ProjectionMatch) {
  if (match.status === 'FINISHED') {
    const home = match.finalHomeScore ?? match.homeScore;
    const away = match.finalAwayScore ?? match.awayScore;
    return home == null || away == null ? null : { home, away };
  }

  if (match.status === 'LIVE') {
    return match.homeScore == null || match.awayScore == null
      ? null
      : { home: match.homeScore, away: match.awayScore };
  }

  return match.predictedHomeScore == null || match.predictedAwayScore == null
    ? null
    : { home: match.predictedHomeScore, away: match.predictedAwayScore };
}

function addResult(standing: MutableStanding, goalsFor: number, goalsAgainst: number) {
  standing.played += 1;
  standing.goalsFor += goalsFor;
  standing.goalsAgainst += goalsAgainst;
  standing.goalDifference = standing.goalsFor - standing.goalsAgainst;
  if (goalsFor > goalsAgainst) {
    standing.wins += 1;
    standing.points += 3;
  } else if (goalsFor === goalsAgainst) {
    standing.draws += 1;
    standing.points += 1;
  } else {
    standing.losses += 1;
  }
}

function createStanding(team: ProjectionTeam): MutableStanding {
  return {
    team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function rankFallback(team: ProjectionTeam) {
  return team.fifaRank ?? Number.MAX_SAFE_INTEGER;
}

function miniTable(
  teamIds: Set<string>,
  matches: ProjectionMatch[],
  teams: Map<string, ProjectionTeam>,
) {
  const standings = new Map<string, MutableStanding>();
  for (const teamId of teamIds) {
    const team = teams.get(teamId);
    if (team) standings.set(teamId, createStanding(team));
  }

  for (const match of matches) {
    if (!teamIds.has(match.homeTeamId) || !teamIds.has(match.awayTeamId)) continue;
    const score = scoreForProjection(match);
    if (!score) continue;
    addResult(standings.get(match.homeTeamId)!, score.home, score.away);
    addResult(standings.get(match.awayTeamId)!, score.away, score.home);
  }
  return standings;
}

export function projectGroupStandings(teams: ProjectionTeam[], matches: ProjectionMatch[]) {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const standings = new Map(teams.map((team) => [team.id, createStanding(team)]));

  for (const match of matches) {
    const score = scoreForProjection(match);
    if (!score) continue;
    const home = standings.get(match.homeTeamId);
    const away = standings.get(match.awayTeamId);
    if (!home || !away) continue;
    addResult(home, score.home, score.away);
    addResult(away, score.away, score.home);
  }

  const rows = [...standings.values()];
  const primaryKey = (row: MutableStanding) =>
    `${row.points}:${row.goalDifference}:${row.goalsFor}`;
  const tiedIdsByKey = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = primaryKey(row);
    const ids = tiedIdsByKey.get(key) ?? new Set<string>();
    ids.add(row.team.id);
    tiedIdsByKey.set(key, ids);
  }
  const miniTables = new Map(
    [...tiedIdsByKey.entries()]
      .filter(([, ids]) => ids.size > 1)
      .map(([key, ids]) => [key, miniTable(ids, matches, teamsById)]),
  );

  rows.sort((a, b) => {
    const primary =
      b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor;
    if (primary) return primary;

    const mini = miniTables.get(primaryKey(a));
    const miniA = mini?.get(a.team.id);
    const miniB = mini?.get(b.team.id);
    const headToHead =
      miniA && miniB
        ? miniB.points - miniA.points ||
          miniB.goalDifference - miniA.goalDifference ||
          miniB.goalsFor - miniA.goalsFor
        : 0;
    if (headToHead) return headToHead;

    return (
      rankFallback(a.team) - rankFallback(b.team) || a.team.name.localeCompare(b.team.name, 'pt-BR')
    );
  });

  return rows.map((row, index): ProjectedStanding => ({ rank: index + 1, ...row }));
}

export function rankThirdPlaced(rows: ProjectedStanding[]) {
  return [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      rankFallback(a.team) - rankFallback(b.team) ||
      a.team.name.localeCompare(b.team.name, 'pt-BR'),
  );
}

function sameGroups(row: readonly string[], groups: Set<string>) {
  return row.length === groups.size && row.every((group) => groups.has(group));
}

export function thirdPlaceAssignments(groups: string[]) {
  const selected = new Set(groups);
  const row = thirdPlaceMatrix.find((candidate) => sameGroups(candidate, selected));
  if (!row) throw new Error(`Combinação de terceiros inválida: ${groups.join(',')}`);
  return Object.fromEntries(thirdPlaceMatrixColumns.map((column, index) => [column, row[index]]));
}

export type GroupQualification = {
  group: string;
  rows: ProjectedStanding[];
  isResolved?: boolean;
};

export type BracketParticipant = {
  homeTeamId: string;
  awayTeamId: string;
};

export type PartialBracketParticipant = {
  homeTeamId: string | null;
  awayTeamId: string | null;
};

export function groupProjectionIsResolved(matches: ProjectionMatch[]) {
  return matches.length >= 6 && matches.every((match) => scoreForProjection(match) !== null);
}

export function buildPartialRoundOf32Participants(groups: GroupQualification[]) {
  const byGroup = new Map(groups.map((group) => [group.group, group]));
  const allGroupsResolved =
    byGroup.size === 12 && [...byGroup.values()].every((group) => group.isResolved);
  let thirdAssignments: Record<string, string> | null = null;

  if (allGroupsResolved) {
    const thirds = rankThirdPlaced(
      groups.flatMap((group) => (group.rows[2] ? [{ ...group.rows[2], group: group.group }] : [])),
    ).slice(0, 8) as Array<ProjectedStanding & { group: string }>;
    if (thirds.length === 8) {
      thirdAssignments = thirdPlaceAssignments(thirds.map((row) => row.group));
    }
  }

  const sourceTeam = (source: string, opponentSource: string) => {
    if (source === '3*') {
      if (!thirdAssignments) return null;
      const winnerGroup = opponentSource.slice(1);
      const thirdGroup = thirdAssignments[winnerGroup];
      return byGroup.get(thirdGroup)?.rows[2]?.team.id ?? null;
    }
    const group = byGroup.get(source.slice(1));
    if (!group?.isResolved) return null;
    return group.rows[Number(source[0]) - 1]?.team.id ?? null;
  };

  return new Map<number, PartialBracketParticipant>(
    knockoutFixtureSeeds
      .filter((fixture) => fixture.stage === 'ROUND_OF_32')
      .map((fixture) => [
        fixture.matchNumber,
        {
          homeTeamId: sourceTeam(fixture.homeSource, fixture.awaySource),
          awayTeamId: sourceTeam(fixture.awaySource, fixture.homeSource),
        },
      ]),
  );
}

export function buildRoundOf32Participants(groups: GroupQualification[]) {
  if (groups.some((group) => !group.isResolved)) return null;
  const byGroup = new Map(groups.map((group) => [group.group, group.rows]));
  const thirds = rankThirdPlaced(
    groups.flatMap((group) => (group.rows[2] ? [{ ...group.rows[2], group: group.group }] : [])),
  ).slice(0, 8) as Array<ProjectedStanding & { group: string }>;

  if (
    byGroup.size !== 12 ||
    [...byGroup.values()].some((rows) => rows.length < 3) ||
    thirds.length !== 8
  ) {
    return null;
  }

  const thirdAssignments = thirdPlaceAssignments(thirds.map((row) => row.group));
  const sourceTeam = (source: string, opponentSource: string) => {
    if (source === '3*') {
      const winnerGroup = opponentSource.slice(1);
      const thirdGroup = thirdAssignments[winnerGroup];
      return byGroup.get(thirdGroup)?.[2]?.team.id;
    }
    const rank = Number(source[0]) - 1;
    return byGroup.get(source.slice(1))?.[rank]?.team.id;
  };

  const participants = new Map<number, BracketParticipant>();
  for (const fixture of knockoutFixtureSeeds.filter((item) => item.stage === 'ROUND_OF_32')) {
    const homeTeamId = sourceTeam(fixture.homeSource, fixture.awaySource);
    const awayTeamId = sourceTeam(fixture.awaySource, fixture.homeSource);
    if (!homeTeamId || !awayTeamId) return null;
    participants.set(fixture.matchNumber, { homeTeamId, awayTeamId });
  }
  return participants;
}

export type BracketPickInput = {
  matchNumber: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  advancingTeamId: string;
};

export type MaterializedBracketPick = BracketPickInput & BracketParticipant;

function teamFromSource(source: string, materialized: Map<number, MaterializedBracketPick>) {
  const sourceMatchNumber = Number(source.slice(1));
  const sourcePick = materialized.get(sourceMatchNumber);
  if (!sourcePick) return null;
  if (source.startsWith('W')) return sourcePick.advancingTeamId;
  return sourcePick.advancingTeamId === sourcePick.homeTeamId
    ? sourcePick.awayTeamId
    : sourcePick.homeTeamId;
}

export function materializeBracket(
  inputs: BracketPickInput[],
  roundOf32: Map<number, BracketParticipant>,
  fixtures: KnockoutFixtureSeed[] = knockoutFixtureSeeds,
) {
  if (inputs.length !== fixtures.length) throw new Error('A chave completa deve conter 32 jogos.');
  const inputByMatch = new Map(inputs.map((input) => [input.matchNumber, input]));
  if (inputByMatch.size !== fixtures.length) throw new Error('A chave contem jogos duplicados.');

  const materialized = new Map<number, MaterializedBracketPick>();
  for (const fixture of [...fixtures].sort((a, b) => a.matchNumber - b.matchNumber)) {
    const input = inputByMatch.get(fixture.matchNumber);
    if (!input) throw new Error(`Palpite ausente para o jogo ${fixture.matchNumber}.`);
    if (
      !Number.isInteger(input.predictedHomeScore) ||
      !Number.isInteger(input.predictedAwayScore) ||
      input.predictedHomeScore < 0 ||
      input.predictedAwayScore < 0 ||
      input.predictedHomeScore > 99 ||
      input.predictedAwayScore > 99
    ) {
      throw new Error(`Placar inválido no jogo ${fixture.matchNumber}.`);
    }

    const seeded = roundOf32.get(fixture.matchNumber);
    const homeTeamId = seeded?.homeTeamId ?? teamFromSource(fixture.homeSource, materialized);
    const awayTeamId = seeded?.awayTeamId ?? teamFromSource(fixture.awaySource, materialized);
    if (!homeTeamId || !awayTeamId)
      throw new Error(`Não foi possível propagar o jogo ${fixture.matchNumber}.`);
    if (![homeTeamId, awayTeamId].includes(input.advancingTeamId)) {
      throw new Error(`Classificado inválido no jogo ${fixture.matchNumber}.`);
    }
    if (
      input.predictedHomeScore !== input.predictedAwayScore &&
      input.advancingTeamId !==
        (input.predictedHomeScore > input.predictedAwayScore ? homeTeamId : awayTeamId)
    ) {
      throw new Error(`O classificado não corresponde ao placar do jogo ${fixture.matchNumber}.`);
    }

    materialized.set(fixture.matchNumber, { ...input, homeTeamId, awayTeamId });
  }
  return [...materialized.values()];
}

export function matrixCombinationKeys() {
  return thirdPlaceMatrix.map((row) => [...row].sort().join(''));
}
