export interface StandingsTeam {
  id: string;
  name: string;
  code: string | null;
  flagUrl: string | null;
  crestUrl: string | null;
}

export interface StandingsParticipant {
  group: string;
  team: StandingsTeam;
}

export interface StandingsMatch {
  group: string;
  status: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface CalculatedStanding {
  rank: number;
  group: string;
  team: StandingsTeam;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  lastFive: Array<'W' | 'D' | 'L'>;
}

type Accumulator = Omit<CalculatedStanding, 'rank'>;

function emptyStanding(participant: StandingsParticipant): Accumulator {
  return {
    group: participant.group,
    team: participant.team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    lastFive: [],
  };
}

function addResult(row: Accumulator, goalsFor: number, goalsAgainst: number) {
  row.played += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  row.goalDifference = row.goalsFor - row.goalsAgainst;
  if (goalsFor > goalsAgainst) {
    row.wins += 1;
    row.points += 3;
    row.lastFive.push('W');
  } else if (goalsFor === goalsAgainst) {
    row.draws += 1;
    row.points += 1;
    row.lastFive.push('D');
  } else {
    row.losses += 1;
    row.lastFive.push('L');
  }
}

export function calculateStandings(
  participants: StandingsParticipant[],
  matches: StandingsMatch[],
) {
  const rows = new Map<string, Accumulator>();
  const key = (group: string, teamId: string) => `${group}:${teamId}`;

  for (const participant of participants) {
    rows.set(key(participant.group, participant.team.id), emptyStanding(participant));
  }

  for (const match of matches) {
    const home = rows.get(key(match.group, match.homeTeamId));
    const away = rows.get(key(match.group, match.awayTeamId));
    if (
      match.status !== 'FINISHED' ||
      match.homeScore == null ||
      match.awayScore == null ||
      !home ||
      !away
    ) {
      continue;
    }
    addResult(home, match.homeScore, match.awayScore);
    addResult(away, match.awayScore, match.homeScore);
  }

  const grouped = new Map<string, Accumulator[]>();
  for (const row of rows.values()) {
    const current = grouped.get(row.group) ?? [];
    current.push(row);
    grouped.set(row.group, current);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map(([group, groupRows]) => ({
      group,
      rows: groupRows
        .sort(
          (a, b) =>
            b.points - a.points ||
            b.goalDifference - a.goalDifference ||
            b.goalsFor - a.goalsFor ||
            a.team.name.localeCompare(b.team.name, 'pt-BR'),
        )
        .map((row, index) => ({ ...row, rank: index + 1, lastFive: row.lastFive.slice(-5) })),
    }));
}
