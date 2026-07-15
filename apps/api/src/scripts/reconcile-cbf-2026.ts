import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CbfSerieA2026Provider,
  type CbfSerieA2026Evidence,
} from '../modules/providers/adapters/cbf-serie-a-2026.provider.js';
import type {
  NormalizedResult,
  NormalizedStanding,
} from '../modules/providers/competition-data-provider.js';
import { assertBrasileirao2026Readiness } from '../modules/brasileirao/brasileirao-2026.service.js';

type DerivedStanding = Pick<
  NormalizedStanding,
  'played' | 'won' | 'drawn' | 'lost' | 'goalsFor' | 'goalsAgainst' | 'points'
>;

function blank(): DerivedStanding {
  return { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

function deriveStandings(results: NormalizedResult[]) {
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

function reconcileStandings(results: NormalizedResult[], standings: NormalizedStanding[]) {
  const derived = deriveStandings(results);
  const fields: Array<keyof DerivedStanding> = [
    'played',
    'won',
    'drawn',
    'lost',
    'goalsFor',
    'goalsAgainst',
    'points',
  ];
  const differences = [];
  for (const standing of standings) {
    const calculated = standing.teamExternalId ? derived.get(standing.teamExternalId) : undefined;
    for (const field of fields) {
      if (!calculated || calculated[field] !== standing[field]) {
        differences.push({
          teamExternalId: standing.teamExternalId,
          teamName: standing.teamName,
          field,
          official: standing[field],
          derived: calculated?.[field] ?? null,
        });
      }
    }
  }
  return differences;
}

function validateEvidence(evidence: CbfSerieA2026Evidence) {
  if (
    evidence.roundsFetched !== 38 ||
    evidence.rawMatches !== 380 ||
    evidence.teams !== 20 ||
    evidence.standings !== 20
  ) {
    throw new Error(`Official source counts are incomplete: ${JSON.stringify(evidence)}`);
  }
}

const provider = new CbfSerieA2026Provider();
const context = { seasonId: 'source-reconciliation-only' };
const [teams, schedule, results, standings, evidence] = await Promise.all([
  provider.syncTeams(context),
  provider.syncSchedule(context),
  provider.syncResults(context),
  provider.syncStandings(context),
  provider.evidence(),
]);
validateEvidence(evidence);
const readiness = assertBrasileirao2026Readiness({ teams, schedule, evidence });
const standingDifferences = reconcileStandings(results, standings);
if (standingDifferences.length > 0) {
  throw new Error(
    `Official standings differ from official finished results: ${JSON.stringify(standingDifferences)}`,
  );
}
const outputDir = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'output',
  'release-gates',
);
await mkdir(outputDir, { recursive: true });
const report = {
  formatVersion: 1,
  suite: 'cbf-source-reconciliation-local',
  status: 'passed',
  pii: false,
  generatedAt: new Date().toISOString(),
  productionEvidence: false,
  evidence,
  readiness,
  counts: {
    teams: teams.length,
    rounds: evidence.roundsFetched,
    rawMatches: evidence.rawMatches,
    scheduledMatches: schedule.length,
    unscheduledMatches: evidence.unscheduledMatches,
    finishedResults: results.length,
    standings: standings.length,
    openingRound20Matches: schedule.filter((item) => item.roundExternalId === 'round:20').length,
    standingDifferences: standingDifferences.length,
  },
};
await writeFile(
  path.join(outputDir, 'cbf-source-reconciliation-local.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
