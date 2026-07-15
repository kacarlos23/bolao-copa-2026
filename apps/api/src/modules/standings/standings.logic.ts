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
  homeYellowCards?: number;
  awayYellowCards?: number;
  homeRedCards?: number;
  awayRedCards?: number;
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
  yellowCards: number;
  redCards: number;
  tieBreakRuleVersion: string;
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
    yellowCards: 0,
    redCards: 0,
    tieBreakRuleVersion: 'legacy-v1',
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
  options: { ruleSet?: 'LEGACY' | 'CBF_SERIE_A_2026' } = {},
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
    home.yellowCards += match.homeYellowCards ?? 0;
    away.yellowCards += match.awayYellowCards ?? 0;
    home.redCards += match.homeRedCards ?? 0;
    away.redCards += match.awayRedCards ?? 0;
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
      rows: sortStandingsRows(groupRows, matches, options.ruleSet ?? 'LEGACY')
        .map((row, index) => ({ ...row, rank: index + 1, lastFive: row.lastFive.slice(-5) })),
    }));
}

function baseLeagueComparison(a: Accumulator, b: Accumulator) {
  return (
    b.points - a.points ||
    b.wins - a.wins ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor
  );
}

function sameBaseLeagueRecord(a: Accumulator, b: Accumulator) {
  return baseLeagueComparison(a, b) === 0;
}

function headToHead(teamId: string, opponentId: string, matches: StandingsMatch[]) {
  let points = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const match of matches) {
    if (match.status !== 'FINISHED' || match.homeScore == null || match.awayScore == null) continue;
    const isHome = match.homeTeamId === teamId && match.awayTeamId === opponentId;
    const isAway = match.awayTeamId === teamId && match.homeTeamId === opponentId;
    if (!isHome && !isAway) continue;
    const scored = isHome ? match.homeScore : match.awayScore;
    const conceded = isHome ? match.awayScore : match.homeScore;
    goalsFor += scored;
    goalsAgainst += conceded;
    if (scored > conceded) points += 3;
    else if (scored === conceded) points += 1;
  }
  return { points, goalDifference: goalsFor - goalsAgainst };
}

function deterministicFallback(a: Accumulator, b: Accumulator) {
  return (
    a.team.name.localeCompare(b.team.name, 'pt-BR') || a.team.id.localeCompare(b.team.id, 'pt-BR')
  );
}

function sortStandingsRows(
  rows: Accumulator[],
  matches: StandingsMatch[],
  ruleSet: 'LEGACY' | 'CBF_SERIE_A_2026',
) {
  if (ruleSet === 'LEGACY') {
    return rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        deterministicFallback(a, b),
    );
  }

  const baseSorted = [...rows].sort(
    (a, b) => baseLeagueComparison(a, b) || deterministicFallback(a, b),
  );
  const result: Accumulator[] = [];
  for (let start = 0; start < baseSorted.length; ) {
    let end = start + 1;
    while (end < baseSorted.length && sameBaseLeagueRecord(baseSorted[start], baseSorted[end])) {
      end += 1;
    }
    const tied = baseSorted.slice(start, end);
    tied.sort((a, b) => {
      if (tied.length === 2) {
        const first = headToHead(a.team.id, b.team.id, matches);
        const second = headToHead(b.team.id, a.team.id, matches);
        const confrontation =
          second.points - first.points || second.goalDifference - first.goalDifference;
        if (confrontation) return confrontation;
      }
      return (
        a.redCards - b.redCards ||
        a.yellowCards - b.yellowCards ||
        deterministicFallback(a, b)
      );
    });
    for (const row of tied) {
      row.tieBreakRuleVersion = 'cbf-rec-2026-art-15-v1';
      result.push(row);
    }
    start = end;
  }
  return result;
}
