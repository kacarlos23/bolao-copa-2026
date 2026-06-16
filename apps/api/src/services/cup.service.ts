import { MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { ensureKnockoutInfrastructure } from './knockout.service.js';

type TeamSummary = {
  id: string;
  name: string;
  code: string | null;
  flagUrl: string | null;
  metadata: Prisma.JsonValue | null;
};

type StandingAccumulator = {
  group: string;
  team: TeamSummary;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  lastFive: Array<'W' | 'D' | 'L'>;
};

type CupTopScorer = {
  rank: number;
  playerName: string;
  position: string | null;
  teamName: string;
  imageUrl: string | null;
  teamFlagUrl: string | null;
  goals: number;
};

const TOP_SCORERS_SETTING_KEY = 'cup.topScorers';

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function jsonString(value: Prisma.JsonValue | null | undefined, key: string) {
  const maybeValue = jsonObject(value)[key];
  return typeof maybeValue === 'string' && maybeValue.trim() ? maybeValue : null;
}

function teamGroup(team: TeamSummary, fallback?: string | null) {
  return jsonString(team.metadata, 'group') ?? fallback ?? 'Sem grupo';
}

function scoreForMatch(match: {
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
}) {
  const homeScore =
    match.status === MatchStatus.FINISHED
      ? (match.finalHomeScore ?? match.homeScore)
      : match.homeScore;
  const awayScore =
    match.status === MatchStatus.FINISHED
      ? (match.finalAwayScore ?? match.awayScore)
      : match.awayScore;

  if (homeScore == null || awayScore == null) return null;
  return { homeScore, awayScore };
}

function emptyStanding(team: TeamSummary, group: string): StandingAccumulator {
  return {
    group,
    team,
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

function addResult(standing: StandingAccumulator, goalsFor: number, goalsAgainst: number) {
  standing.played += 1;
  standing.goalsFor += goalsFor;
  standing.goalsAgainst += goalsAgainst;
  standing.goalDifference = standing.goalsFor - standing.goalsAgainst;

  if (goalsFor > goalsAgainst) {
    standing.wins += 1;
    standing.points += 3;
    standing.lastFive.push('W');
    return;
  }

  if (goalsFor === goalsAgainst) {
    standing.draws += 1;
    standing.points += 1;
    standing.lastFive.push('D');
    return;
  }

  standing.losses += 1;
  standing.lastFive.push('L');
}

function sortGroups(groupA: string, groupB: string) {
  if (groupA === 'Sem grupo') return 1;
  if (groupB === 'Sem grupo') return -1;
  return groupA.localeCompare(groupB, 'pt-BR', { numeric: true });
}

function topScorersFromSetting(value: Prisma.JsonValue | null | undefined): CupTopScorer[] {
  const rawTopScorers = jsonObject(value).topScorers;
  if (!Array.isArray(rawTopScorers)) return [];

  return rawTopScorers
    .map((rawScorer): CupTopScorer | null => {
      if (!rawScorer || typeof rawScorer !== 'object' || Array.isArray(rawScorer)) return null;
      const scorer = rawScorer as Record<string, unknown>;
      const rank = typeof scorer.rank === 'number' ? scorer.rank : null;
      const playerName = typeof scorer.playerName === 'string' ? scorer.playerName : null;
      const goals = typeof scorer.goals === 'number' ? scorer.goals : null;
      if (!rank || !playerName || goals == null) return null;

      return {
        rank,
        playerName,
        goals,
        position: typeof scorer.position === 'string' ? scorer.position : null,
        teamName: typeof scorer.teamName === 'string' ? scorer.teamName : '',
        imageUrl: typeof scorer.imageUrl === 'string' ? scorer.imageUrl : null,
        teamFlagUrl: typeof scorer.teamFlagUrl === 'string' ? scorer.teamFlagUrl : null,
      };
    })
    .filter((scorer): scorer is CupTopScorer => Boolean(scorer))
    .sort(
      (a, b) =>
        b.goals - a.goals || a.rank - b.rank || a.playerName.localeCompare(b.playerName, 'pt-BR'),
    );
}

export async function getCupOverview() {
  await ensureKnockoutInfrastructure();
  const [teams, matches, knockoutFixtures, topScorersSetting] = await Promise.all([
    prisma.team.findMany({ orderBy: [{ name: 'asc' }] }),
    prisma.match.findMany({
      orderBy: { startsAt: 'asc' },
      include: {
        homeTeam: true,
        awayTeam: true,
      },
    }),
    prisma.knockoutFixture.findMany({
      orderBy: { matchNumber: 'asc' },
      include: { homeTeam: true, awayTeam: true, winnerTeam: true },
    }),
    prisma.appSetting.findUnique({ where: { key: TOP_SCORERS_SETTING_KEY } }),
  ]);

  const standings = new Map<string, StandingAccumulator>();
  const standingKey = (teamId: string, group: string) => `${group}:${teamId}`;

  for (const team of teams) {
    const group = teamGroup(team);
    standings.set(standingKey(team.id, group), emptyStanding(team, group));
  }

  for (const match of matches) {
    const matchGroup = jsonString(match.rawPayload, 'group') ?? teamGroup(match.homeTeam);
    const homeKey = standingKey(match.homeTeam.id, matchGroup);
    const awayKey = standingKey(match.awayTeam.id, matchGroup);

    if (!standings.has(homeKey)) {
      standings.set(homeKey, emptyStanding(match.homeTeam, matchGroup));
    }
    if (!standings.has(awayKey)) {
      standings.set(awayKey, emptyStanding(match.awayTeam, matchGroup));
    }

    const score = scoreForMatch(match);
    if (match.status !== MatchStatus.FINISHED || !score) continue;

    addResult(standings.get(homeKey)!, score.homeScore, score.awayScore);
    addResult(standings.get(awayKey)!, score.awayScore, score.homeScore);
  }

  const groups = [...standings.values()]
    .filter((row) => row.group !== 'Sem grupo' || row.played > 0)
    .reduce<Record<string, StandingAccumulator[]>>((acc, row) => {
      acc[row.group] = acc[row.group] ?? [];
      acc[row.group].push(row);
      return acc;
    }, {});

  const standingsByGroup = Object.entries(groups)
    .sort(([groupA], [groupB]) => sortGroups(groupA, groupB))
    .map(([group, rows]) => ({
      group,
      rows: rows
        .sort(
          (rowA, rowB) =>
            rowB.points - rowA.points ||
            rowB.goalDifference - rowA.goalDifference ||
            rowB.goalsFor - rowA.goalsFor ||
            rowA.team.name.localeCompare(rowB.team.name, 'pt-BR'),
        )
        .map((row, index) => ({
          rank: index + 1,
          group: row.group,
          team: row.team,
          played: row.played,
          wins: row.wins,
          draws: row.draws,
          losses: row.losses,
          goalsFor: row.goalsFor,
          goalsAgainst: row.goalsAgainst,
          goalDifference: row.goalDifference,
          points: row.points,
          lastFive: row.lastFive.slice(-5),
        })),
    }));

  const matchResults = matches.map((match) => {
    const score = scoreForMatch(match);
    return {
      id: match.id,
      startsAt: match.startsAt,
      status: match.status,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: score?.homeScore ?? null,
      awayScore: score?.awayScore ?? null,
      round: jsonString(match.rawPayload, 'round'),
      group: jsonString(match.rawPayload, 'group'),
    };
  });

  return {
    checkedAt: new Date().toISOString(),
    standingsByGroup,
    matches: matchResults,
    knockoutFixtures,
    topScorers: topScorersFromSetting(topScorersSetting?.value),
  };
}
