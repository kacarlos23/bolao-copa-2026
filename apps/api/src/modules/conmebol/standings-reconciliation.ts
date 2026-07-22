import type {
  NormalizedResult,
  NormalizedStanding,
} from '../providers/competition-data-provider.js';

type DerivedStanding = Pick<
  NormalizedStanding,
  'played' | 'won' | 'drawn' | 'lost' | 'goalsFor' | 'goalsAgainst' | 'points'
>;

function blank(): DerivedStanding {
  return { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

export function deriveGroupStandings(results: NormalizedResult[]) {
  const rows = new Map<string, DerivedStanding>();
  for (const result of results) {
    if (!result.homeTeamExternalId || !result.awayTeamExternalId) {
      throw new Error(`Result ${result.externalId} has no official team IDs.`);
    }
    const home = rows.get(result.homeTeamExternalId) ?? blank();
    const away = rows.get(result.awayTeamExternalId) ?? blank();
    home.played += 1;
    away.played += 1;
    home.goalsFor += result.homeScore;
    home.goalsAgainst += result.awayScore;
    away.goalsFor += result.awayScore;
    away.goalsAgainst += result.homeScore;
    if (result.homeScore > result.awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (result.homeScore < result.awayScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
    rows.set(result.homeTeamExternalId, home);
    rows.set(result.awayTeamExternalId, away);
  }
  return rows;
}

export function groupStandingDifferences(
  results: NormalizedResult[],
  standings: NormalizedStanding[],
) {
  const derived = deriveGroupStandings(results);
  const fields: Array<keyof DerivedStanding> = [
    'played',
    'won',
    'drawn',
    'lost',
    'goalsFor',
    'goalsAgainst',
    'points',
  ];
  return standings.flatMap((standing) => {
    const calculated = standing.teamExternalId ? derived.get(standing.teamExternalId) : undefined;
    return fields
      .filter((field) => !calculated || calculated[field] !== standing[field])
      .map((field) => ({
        teamExternalId: standing.teamExternalId,
        teamName: standing.teamName,
        field,
        official: standing[field],
        derived: calculated?.[field] ?? null,
      }));
  });
}
