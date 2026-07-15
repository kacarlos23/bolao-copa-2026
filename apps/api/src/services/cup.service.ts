import { MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { ensureKnockoutInfrastructure } from './knockout.service.js';
import { calculateStandings } from '../modules/standings/standings.logic.js';

type TeamSummary = {
  id: string;
  name: string;
  code: string | null;
  flagUrl: string | null;
  metadata: Prisma.JsonValue | null;
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

export async function getCupOverview(seasonId: string) {
  await ensureKnockoutInfrastructure();
  const [seasonTeams, matches, knockoutFixtures, topScorersSetting] = await Promise.all([
    prisma.seasonTeam.findMany({
      where: { seasonId },
      orderBy: [{ team: { name: 'asc' } }],
      select: { groupName: true, team: true },
    }),
    prisma.match.findMany({
      where: { seasonId },
      orderBy: { startsAt: 'asc' },
      include: {
        homeTeam: true,
        awayTeam: true,
      },
    }),
    prisma.knockoutFixture.findMany({
      where: { seasonId },
      orderBy: { matchNumber: 'asc' },
      include: { homeTeam: true, awayTeam: true, winnerTeam: true },
    }),
    prisma.appSetting.findUnique({ where: { key: TOP_SCORERS_SETTING_KEY } }),
  ]);
  const groupByTeam = new Map(
    seasonTeams.map((entry) => [entry.team.id, entry.groupName ?? teamGroup(entry.team)]),
  );
  const standingsByGroup = calculateStandings(
    seasonTeams.map((entry) => ({
      group: entry.groupName ?? teamGroup(entry.team),
      team: entry.team,
    })),
    matches.map((match) => {
      const score = scoreForMatch(match);
      return {
        group:
          jsonString(match.rawPayload, 'group') ??
          groupByTeam.get(match.homeTeam.id) ??
          'Sem grupo',
        status: match.status,
        homeTeamId: match.homeTeam.id,
        awayTeamId: match.awayTeam.id,
        homeScore: score?.homeScore ?? null,
        awayScore: score?.awayScore ?? null,
      };
    }),
  ).filter((group) => group.group !== 'Sem grupo' || group.rows.some((row) => row.played > 0));

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
