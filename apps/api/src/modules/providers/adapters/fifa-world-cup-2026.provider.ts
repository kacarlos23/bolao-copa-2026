import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fetchBytesWithPolicy } from '../../../http/fetch-policy.js';
import type {
  CompetitionDataProvider,
  NormalizedMatch,
  NormalizedResult,
  NormalizedTeam,
  ProviderContext,
  ProviderHealth,
  ProviderSnapshotEvidence,
} from '../competition-data-provider.js';
import {
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedTeamArraySchema,
} from '../competition-data-provider.js';

export const FIFA_WORLD_CUP_2026_MATCHES_URL =
  'https://api.fifa.com/api/v3/calendar/matches?idSeason=285023&idCompetition=17&count=500&language=pt';

const localizedSchema = z.array(
  z.object({ Locale: z.string().optional(), Description: z.string().min(1) }).passthrough(),
);
const teamSchema = z
  .object({
    IdTeam: z.string().min(1),
    IdCountry: z.string().min(2).max(3).nullable().optional(),
    TeamName: localizedSchema,
    Abbreviation: z.string().min(2).max(16),
    PictureUrl: z.string().url().nullable().optional(),
  })
  .passthrough();
const stadiumSchema = z
  .object({
    Name: localizedSchema,
    CityName: localizedSchema,
    IdCountry: z.string().min(2).max(3).nullable().optional(),
  })
  .passthrough();
const matchSchema = z
  .object({
    IdMatch: z.string().min(1),
    IdStage: z.string().min(1),
    MatchNumber: z.number().int().min(1),
    Date: z.string().datetime({ offset: true }),
    TimeDefined: z.boolean().nullable().optional(),
    MatchStatus: z.number().int().nullable().optional(),
    ResultType: z.number().int().nullable().optional(),
    StageName: localizedSchema,
    GroupName: localizedSchema,
    Home: teamSchema,
    Away: teamSchema,
    HomeTeamScore: z.number().int().min(0).max(99).nullable().optional(),
    AwayTeamScore: z.number().int().min(0).max(99).nullable().optional(),
    HomeTeamPenaltyScore: z.number().int().min(0).max(99).nullable().optional(),
    AwayTeamPenaltyScore: z.number().int().min(0).max(99).nullable().optional(),
    Winner: z.string().nullable().optional(),
    Stadium: stadiumSchema.nullable().optional(),
  })
  .passthrough();
const payloadSchema = z.object({ Results: z.array(matchSchema).min(104).max(200) }).passthrough();

type FifaMatch = z.infer<typeof matchSchema>;

export interface FifaLegacyKnockoutUpdate {
  matchNumber: number;
  startsAt: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED';
  homeCode: string;
  awayCode: string;
  winnerCode?: string;
  homeScore?: number;
  awayScore?: number;
  penaltyHomeScore?: number;
  penaltyAwayScore?: number;
  officialMatchId: string;
}

export interface ParsedFifaWorldCup2026 {
  teams: NormalizedTeam[];
  schedule: NormalizedMatch[];
  results: NormalizedResult[];
  legacyKnockout: FifaLegacyKnockoutUpdate[];
}

function localized(values: Array<{ Locale?: string; Description: string }>) {
  return (
    values.find((value) => value.Locale === 'pt-BR')?.Description ??
    values.find((value) => value.Locale === 'pt-PT')?.Description ??
    values.find((value) => value.Locale === 'en-GB')?.Description ??
    values[0]?.Description ??
    ''
  );
}

function teamExternalId(team: z.infer<typeof teamSchema>) {
  return `team:${team.IdTeam}`;
}

function matchExternalId(match: FifaMatch) {
  return `match:${match.IdMatch}`;
}

function score(match: FifaMatch) {
  const home = match.HomeTeamScore;
  const away = match.AwayTeamScore;
  return typeof home === 'number' && typeof away === 'number' ? { home, away } : null;
}

function status(match: FifaMatch, now: Date) {
  const currentScore = score(match);
  if (!currentScore) return 'SCHEDULED' as const;
  if (match.Winner || now.getTime() >= new Date(match.Date).getTime() + 4 * 60 * 60_000) {
    return 'FINISHED' as const;
  }
  return 'LIVE' as const;
}

function normalizedTeam(team: z.infer<typeof teamSchema>, groupName?: string): NormalizedTeam {
  return {
    externalId: teamExternalId(team),
    name: localized(team.TeamName),
    code: team.Abbreviation,
    type: 'NATIONAL_TEAM',
    ...(groupName ? { groupName } : {}),
    ...(team.IdCountry ? { countryCode: team.IdCountry } : {}),
    providerMetadata: { fifaTeamId: team.IdTeam, flagTemplate: team.PictureUrl ?? null },
  };
}

export function parseFifaWorldCup2026Payload(
  payload: unknown,
  now = new Date(),
): ParsedFifaWorldCup2026 {
  const officialMatches = payloadSchema.parse(payload).Results;
  const teamById = new Map<string, NormalizedTeam>();
  const schedule: NormalizedMatch[] = [];
  const results: NormalizedResult[] = [];
  const legacyKnockout: FifaLegacyKnockoutUpdate[] = [];

  for (const match of officialMatches) {
    const groupName = localized(match.GroupName).replace(/^Grupo\s+/i, '') || undefined;
    for (const team of [match.Home, match.Away]) {
      const candidate = normalizedTeam(team, groupName);
      const previous = teamById.get(candidate.externalId);
      teamById.set(candidate.externalId, previous?.groupName ? previous : candidate);
    }

    const currentStatus = status(match, now);
    const currentScore = score(match);
    if (match.MatchNumber > 72) {
      const winnerCode =
        match.Winner === match.Home.IdTeam
          ? match.Home.Abbreviation
          : match.Winner === match.Away.IdTeam
            ? match.Away.Abbreviation
            : undefined;
      legacyKnockout.push({
        matchNumber: match.MatchNumber,
        startsAt: match.Date,
        status: currentStatus,
        homeCode: match.Home.Abbreviation,
        awayCode: match.Away.Abbreviation,
        ...(winnerCode ? { winnerCode } : {}),
        ...(currentScore ? { homeScore: currentScore.home, awayScore: currentScore.away } : {}),
        ...(typeof match.HomeTeamPenaltyScore === 'number' &&
        typeof match.AwayTeamPenaltyScore === 'number'
          ? {
              penaltyHomeScore: match.HomeTeamPenaltyScore,
              penaltyAwayScore: match.AwayTeamPenaltyScore,
            }
          : {}),
        officialMatchId: match.IdMatch,
      });
      continue;
    }

    const venueName = match.Stadium ? localized(match.Stadium.Name) : '';
    const venueCity = match.Stadium ? localized(match.Stadium.CityName) : '';
    schedule.push({
      externalId: matchExternalId(match),
      homeTeamExternalId: teamExternalId(match.Home),
      awayTeamExternalId: teamExternalId(match.Away),
      homeTeamName: localized(match.Home.TeamName),
      awayTeamName: localized(match.Away.TeamName),
      startsAt: match.Date,
      kickoffConfirmed: match.TimeDefined !== false,
      status: currentStatus,
      ...(groupName ? { groupName } : {}),
      ...(venueName
        ? {
            venue: {
              name: venueName,
              ...(venueCity ? { city: venueCity } : {}),
              ...(match.Stadium?.IdCountry ? { countryCode: match.Stadium.IdCountry } : {}),
            },
          }
        : {}),
      providerMetadata: {
        fifaMatchNumber: match.MatchNumber,
        fifaStageId: match.IdStage,
        stageName: localized(match.StageName),
      },
    });
    if (currentScore && currentStatus !== 'SCHEDULED') {
      results.push({
        externalId: `result:${match.IdMatch}`,
        matchExternalId: matchExternalId(match),
        homeTeamExternalId: teamExternalId(match.Home),
        awayTeamExternalId: teamExternalId(match.Away),
        homeTeamName: localized(match.Home.TeamName),
        awayTeamName: localized(match.Away.TeamName),
        startsAt: match.Date,
        homeScore: currentScore.home,
        awayScore: currentScore.away,
        status: currentStatus,
        providerMetadata: {
          fifaMatchNumber: match.MatchNumber,
          resultType: match.ResultType ?? null,
          winnerTeamId: match.Winner ?? null,
        },
      });
    }
  }

  return {
    teams: normalizedTeamArraySchema.parse([...teamById.values()]),
    schedule: normalizedMatchArraySchema.parse(schedule),
    results: normalizedResultArraySchema.parse(results),
    legacyKnockout: legacyKnockout.sort((left, right) => left.matchNumber - right.matchNumber),
  };
}

interface Collection {
  parsed: ParsedFifaWorldCup2026;
  evidence: ProviderSnapshotEvidence;
}

export class FifaWorldCup2026Provider implements CompetitionDataProvider {
  readonly name = 'fifa-official';
  readonly source = FIFA_WORLD_CUP_2026_MATCHES_URL;
  private collectionPromise?: Promise<Collection>;

  constructor(
    private readonly fetchOfficial: () => Promise<Buffer> = () =>
      fetchBytesWithPolicy(
        FIFA_WORLD_CUP_2026_MATCHES_URL,
        { headers: { accept: 'application/json', 'user-agent': 'bolao-admin-refresh/1.0' } },
        { timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024, retries: 2 },
      ),
  ) {}

  private collect() {
    if (!this.collectionPromise) {
      this.collectionPromise = this.fetchOfficial().then((bytes) => {
        const collectedAt = new Date().toISOString();
        const checksum = createHash('sha256').update(bytes).digest('hex');
        return {
          parsed: parseFifaWorldCup2026Payload(JSON.parse(bytes.toString('utf8'))),
          evidence: {
            provider: this.name,
            competition: 'world-cup',
            season: '2026',
            source: this.source,
            collectedAt,
            collectionTimezone: 'UTC',
            sourceOffset: '+00:00',
            checksum,
            byteLength: bytes.byteLength,
            artifacts: [
              {
                kind: 'RESPONSE',
                source: this.source,
                contentType: 'application/json',
                checksum,
                byteLength: bytes.byteLength,
              },
            ],
          },
        };
      });
    }
    return this.collectionPromise;
  }

  async syncTeams(_context: ProviderContext) {
    return (await this.collect()).parsed.teams;
  }

  async syncSchedule(_context: ProviderContext) {
    return (await this.collect()).parsed.schedule;
  }

  async syncResults(_context: ProviderContext) {
    return (await this.collect()).parsed.results;
  }

  async legacyKnockoutUpdates() {
    return (await this.collect()).parsed.legacyKnockout;
  }

  async snapshotEvidence() {
    return (await this.collect()).evidence;
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    try {
      await this.collect();
      return { ok: true, checkedAt: new Date().toISOString() };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'FIFA provider error',
      };
    }
  }
}
