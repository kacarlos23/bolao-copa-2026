import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  fetchBytesWithPolicy,
  fetchTextWithPolicy,
  type FetchTextPolicy,
} from '../../../http/fetch-policy.js';
import {
  type CompetitionDataProvider,
  type NormalizedMatch,
  type NormalizedResult,
  type NormalizedStanding,
  type NormalizedTeam,
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedTeamArraySchema,
  type ProviderContext,
  type ProviderHealth,
} from '../competition-data-provider.js';
import { checksum } from '../provider-utils.js';

export const CBF_SERIE_A_2026_COMPETITION_ID = '1260611';
export const CBF_SERIE_A_2026_PHASE_ID = '1993';
export const CBF_SERIE_A_2026_TABLE_URL =
  'https://www.cbf.com.br/futebol-brasileiro/tabelas/campeonato-brasileiro/serie-a/2026';
export const CBF_SERIE_A_2026_BASIC_TABLE_URL =
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_Detalhada_BSA_2026_16_01_7a2261a9d7.pdf';
export const CBF_SERIE_A_2026_REGULATION_URL =
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Brasileiro_Serie_A_2026_c984f8cf05.pdf';
export const CBF_SERIE_A_2026_ROUND_URL = (round: number) =>
  `https://www.cbf.com.br/api/cbf/jogos/campeonato/${CBF_SERIE_A_2026_COMPETITION_ID}/rodada/${round}/fase/${CBF_SERIE_A_2026_PHASE_ID}`;

const CBF_POLICY = {
  timeoutMs: 10_000,
  maxBytes: 512 * 1024,
  retries: 2,
} as const;

export interface CbfDocumentPin {
  kind: 'BASIC_TABLE' | 'REGULATION';
  url: string;
  sha256: string;
  bytes: number;
}

export const CBF_SERIE_A_2026_DOCUMENT_PINS: readonly CbfDocumentPin[] = [
  {
    kind: 'BASIC_TABLE',
    url: CBF_SERIE_A_2026_BASIC_TABLE_URL,
    sha256: '7ee848ecac23d92be55222e5adec6c992cddbf6eb457d814e5be3d3306224782',
    bytes: 742_577,
  },
  {
    kind: 'REGULATION',
    url: CBF_SERIE_A_2026_REGULATION_URL,
    sha256: '1dadb33c3b2174540a0ff46489ff9b8392072118c47b334240d1351335d76f6a',
    bytes: 598_606,
  },
] as const;

function bytesSha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

const projectedTeamSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(160),
    goals: z.number().int().nonnegative().max(99).nullable(),
  })
  .strict();

const projectedPenaltySchema = z
  .object({
    type: z.string().trim().max(40),
    result: z.string().trim().max(80),
    clubId: z.string().trim().max(40),
  })
  .strict();

const projectedGameSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    reference: z.string().trim().min(1).max(40),
    round: z.number().int().min(1).max(38),
    home: projectedTeamSchema,
    away: projectedTeamSchema,
    date: z.string().trim().min(1).max(40),
    time: z.string().trim().max(20),
    penalties: z.array(projectedPenaltySchema).max(500),
  })
  .strict();

const projectedRoundSchema = z
  .object({
    groups: z.array(z.object({ games: z.array(z.unknown()).max(50) }).strict()).max(20),
  })
  .strict();

function text(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function numberOrNull(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function projectTeam(value: unknown) {
  const raw = object(value);
  return projectedTeamSchema.parse({
    id: text(raw?.id),
    name: text(raw?.nome),
    goals: numberOrNull(raw?.gols),
  });
}

function projectPenalty(value: unknown) {
  const raw = object(value);
  if (!raw) return null;
  const type = text(raw.tipo);
  const result = text(raw.resultado);
  const clubId = text(raw.clube_id);
  if (!type || !result || !clubId) return null;
  return projectedPenaltySchema.parse({ type, result, clubId });
}

function projectGame(value: unknown, expectedRound: number) {
  const raw = object(value);
  if (!raw) throw new Error(`CBF round ${expectedRound} contains a non-object game.`);
  const round = Number(text(raw.rodada));
  if (round !== expectedRound) {
    throw new Error(`CBF game ${String(raw.id_jogo)} belongs to unexpected round ${round}.`);
  }
  return projectedGameSchema.parse({
    id: text(raw.id_jogo),
    reference: text(raw.num_jogo),
    round,
    home: projectTeam(raw.mandante),
    away: projectTeam(raw.visitante),
    date: text(raw.data),
    time: text(raw.hora) ?? '',
    penalties: Array.isArray(raw.penalidades)
      ? raw.penalidades
          .map(projectPenalty)
          .filter((item): item is z.infer<typeof projectedPenaltySchema> => Boolean(item))
      : [],
  });
}

function projectRoundPayload(value: unknown) {
  const raw = object(value);
  const groups = Array.isArray(raw?.jogos)
    ? raw.jogos.map((entry) => {
        const group = object(entry);
        return { games: Array.isArray(group?.jogo) ? group.jogo : [] };
      })
    : [];
  return projectedRoundSchema.parse({ groups });
}

export function parseCbfLocalStartsAt(dateValue: string, timeValue: string) {
  const dateMatch = dateValue.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const timeMatch = timeValue.trim().match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch;
  const [, hour, minute] = timeMatch;
  const candidate = `${year}-${month}-${day}T${hour}:${minute}:00-03:00`;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(parsed);
  const parts = Object.fromEntries(local.map((part) => [part.type, part.value]));
  if (
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  ) {
    return null;
  }
  return parsed.toISOString();
}

function externalTeamId(teamId: string) {
  return `team:${teamId}`;
}

function externalMatchId(matchId: string) {
  return `match:${matchId}`;
}

function cardCounts(game: z.infer<typeof projectedGameSchema>) {
  const counts = {
    homeYellowCards: 0,
    awayYellowCards: 0,
    homeRedCards: 0,
    awayRedCards: 0,
  };
  for (const penalty of game.penalties) {
    if (penalty.type.toUpperCase() !== 'PENALIDADE') continue;
    const isHome = penalty.clubId === game.home.id;
    const isAway = penalty.clubId === game.away.id;
    if (!isHome && !isAway) continue;
    const result = penalty.result.toUpperCase();
    if (result.includes('AMARELO')) {
      if (isHome) counts.homeYellowCards += 1;
      if (isAway) counts.awayYellowCards += 1;
    }
    if (result.includes('VERMELHO')) {
      if (isHome) counts.homeRedCards += 1;
      if (isAway) counts.awayRedCards += 1;
    }
  }
  return counts;
}

export interface CbfRoundParseResult {
  teams: NormalizedTeam[];
  schedule: NormalizedMatch[];
  results: NormalizedResult[];
  rawMatches: number;
  unscheduledExternalIds: string[];
}

function decodeHtml(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .trim();
}

function integerCell(value: string, field: string) {
  const text = decodeHtml(value.replace(/<[^>]+>/g, ''));
  const parsed = Number(text);
  if (!Number.isInteger(parsed)) throw new Error(`CBF standing ${field} is invalid.`);
  return parsed;
}

export function parseCbfSerieA2026Standings(payload: string): NormalizedStanding[] {
  const body = payload.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) throw new Error('CBF standings table was not found.');
  const standings = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => {
    const html = row[1];
    const team = html.match(
      /\/futebol-brasileiro\/times\/campeonato-brasileiro\/serie-a\/2026\/(\d+)[^>]*>[\s\S]*?<strong[^>]*teamName[^>]*>([^<]+)<\/strong>/i,
    );
    const position = html.match(/<strong[^>]*position[^>]*>\s*(\d+)\s*<\/strong>/i);
    const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (!team || !position || cells.length < 12) throw new Error('CBF standing row is incomplete.');
    const teamId = team[1];
    return {
      externalId: `standing:${teamId}`,
      teamExternalId: externalTeamId(teamId),
      teamName: decodeHtml(team[2]),
      position: Number(position[1]),
      points: integerCell(cells[1], 'points'),
      played: integerCell(cells[2], 'played'),
      won: integerCell(cells[3], 'won'),
      drawn: integerCell(cells[4], 'drawn'),
      lost: integerCell(cells[5], 'lost'),
      goalsFor: integerCell(cells[6], 'goalsFor'),
      goalsAgainst: integerCell(cells[7], 'goalsAgainst'),
    };
  });
  const parsed = normalizedStandingArraySchema.parse(standings);
  if (
    parsed.length !== 20 ||
    new Set(parsed.map((standing) => standing.teamExternalId)).size !== 20
  ) {
    throw new Error(`CBF standings must contain 20 unique teams; received ${parsed.length}.`);
  }
  return parsed;
}

export function parseCbfSerieA2026Round(
  payload: string,
  expectedRound: number,
): CbfRoundParseResult {
  const projected = projectRoundPayload(JSON.parse(payload));
  const games = projected.groups
    .flatMap((group) => group.games)
    .map((game) => projectGame(game, expectedRound));
  const teams = new Map<string, NormalizedTeam>();
  const schedule: NormalizedMatch[] = [];
  const results: NormalizedResult[] = [];
  const unscheduledExternalIds: string[] = [];

  for (const game of games) {
    const homeTeamExternalId = externalTeamId(game.home.id);
    const awayTeamExternalId = externalTeamId(game.away.id);
    teams.set(homeTeamExternalId, {
      externalId: homeTeamExternalId,
      name: game.home.name,
      type: 'CLUB',
    });
    teams.set(awayTeamExternalId, {
      externalId: awayTeamExternalId,
      name: game.away.name,
      type: 'CLUB',
    });
    const externalId = externalMatchId(game.id);
    const startsAt = parseCbfLocalStartsAt(game.date, game.time);
    if (!startsAt) {
      unscheduledExternalIds.push(externalId);
      continue;
    }
    const finished = game.home.goals !== null && game.away.goals !== null;
    schedule.push({
      externalId,
      homeTeamExternalId,
      awayTeamExternalId,
      homeTeamName: game.home.name,
      awayTeamName: game.away.name,
      startsAt,
      status: finished ? 'FINISHED' : 'SCHEDULED',
      stageExternalId: `stage:${CBF_SERIE_A_2026_PHASE_ID}`,
      roundExternalId: `round:${expectedRound}`,
    });
    if (finished) {
      results.push({
        externalId: `result:${externalId}`,
        matchExternalId: externalId,
        homeTeamExternalId,
        awayTeamExternalId,
        homeTeamName: game.home.name,
        awayTeamName: game.away.name,
        startsAt,
        homeScore: game.home.goals!,
        awayScore: game.away.goals!,
        ...cardCounts(game),
        status: 'FINISHED',
      });
    }
  }

  return {
    teams: normalizedTeamArraySchema.parse([...teams.values()]),
    schedule: normalizedMatchArraySchema.parse(schedule),
    results: normalizedResultArraySchema.parse(results),
    rawMatches: games.length,
    unscheduledExternalIds,
  };
}

export interface CbfSerieA2026Evidence {
  source: string;
  collectedAt: string;
  timezone: 'America/Sao_Paulo';
  checksum: string;
  roundsFetched: number;
  rawMatches: number;
  reconciledMatches: number;
  unscheduledMatches: number;
  finishedResults: number;
  teams: number;
  standings: number;
  documents: Array<{
    kind: 'BASIC_TABLE' | 'REGULATION';
    url: string;
    checksum: string;
    bytes: number;
    collectedAt: string;
  }>;
}

interface CbfCollection {
  teams: NormalizedTeam[];
  schedule: NormalizedMatch[];
  results: NormalizedResult[];
  standings: NormalizedStanding[];
  evidence: CbfSerieA2026Evidence;
}

export class CbfSerieA2026Provider implements CompetitionDataProvider {
  readonly name = 'cbf-official';
  readonly source = CBF_SERIE_A_2026_TABLE_URL;
  private collected?: Promise<CbfCollection>;

  constructor(
    private readonly fetchPolicy: FetchTextPolicy = CBF_POLICY,
    private readonly documentPins: readonly CbfDocumentPin[] = CBF_SERIE_A_2026_DOCUMENT_PINS,
  ) {}

  private collect() {
    this.collected ??= this.collectOnce();
    return this.collected;
  }

  private async collectOnce(): Promise<CbfCollection> {
    const collectedAt = new Date().toISOString();
    const [standingsPayload, documents] = await Promise.all([
      fetchTextWithPolicy(
        CBF_SERIE_A_2026_TABLE_URL,
        {
          headers: {
            accept: 'text/html',
            'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0',
          },
        },
        { ...this.fetchPolicy, maxBytes: Math.max(this.fetchPolicy.maxBytes, 2 * 1024 * 1024) },
      ),
      Promise.all(
        this.documentPins.map(async (document) => {
          const bytes = await fetchBytesWithPolicy(
            document.url,
            {
              headers: {
                accept: 'application/pdf',
                'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0',
              },
            },
            {
              ...this.fetchPolicy,
              maxBytes: Math.max(this.fetchPolicy.maxBytes, 5 * 1024 * 1024),
            },
          );
          const actualChecksum = bytesSha256(bytes);
          if (actualChecksum !== document.sha256 || bytes.byteLength !== document.bytes) {
            throw new Error(
              `CBF ${document.kind} document changed: expected ${document.sha256}/${document.bytes}, got ${actualChecksum}/${bytes.byteLength}.`,
            );
          }
          return {
            kind: document.kind,
            url: document.url,
            checksum: actualChecksum,
            bytes: bytes.byteLength,
            collectedAt,
          };
        }),
      ),
    ]);
    const payloads = new Array<string>(38);
    let nextRound = 1;
    const worker = async () => {
      while (nextRound <= 38) {
        const round = nextRound;
        nextRound += 1;
        payloads[round - 1] = await fetchTextWithPolicy(
          CBF_SERIE_A_2026_ROUND_URL(round),
          {
            headers: {
              accept: 'application/json',
              'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0',
            },
          },
          this.fetchPolicy,
        );
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    const teams = new Map<string, NormalizedTeam>();
    const schedule = new Map<string, NormalizedMatch>();
    const results = new Map<string, NormalizedResult>();
    let rawMatches = 0;
    let unscheduledMatches = 0;
    for (const [index, payload] of payloads.entries()) {
      const parsed = parseCbfSerieA2026Round(payload, index + 1);
      rawMatches += parsed.rawMatches;
      unscheduledMatches += parsed.unscheduledExternalIds.length;
      for (const team of parsed.teams) teams.set(team.externalId, team);
      for (const match of parsed.schedule) schedule.set(match.externalId, match);
      for (const result of parsed.results) results.set(result.externalId, result);
    }
    const collection = {
      teams: normalizedTeamArraySchema.parse([...teams.values()]),
      schedule: normalizedMatchArraySchema.parse([...schedule.values()]),
      results: normalizedResultArraySchema.parse([...results.values()]),
      standings: parseCbfSerieA2026Standings(standingsPayload),
    };
    return {
      ...collection,
      evidence: {
        source: this.source,
        collectedAt,
        timezone: 'America/Sao_Paulo',
        checksum: checksum({
          collection,
          documents: documents.map(({ kind, url, checksum: documentChecksum, bytes }) => ({
            kind,
            url,
            checksum: documentChecksum,
            bytes,
          })),
        }),
        roundsFetched: payloads.length,
        rawMatches,
        reconciledMatches: collection.schedule.length,
        unscheduledMatches,
        finishedResults: collection.results.length,
        teams: collection.teams.length,
        standings: collection.standings.length,
        documents,
      },
    };
  }

  async evidence() {
    return (await this.collect()).evidence;
  }

  async syncTeams(_context: ProviderContext) {
    return (await this.collect()).teams;
  }

  async syncSchedule(_context: ProviderContext) {
    return (await this.collect()).schedule;
  }

  async syncResults(_context: ProviderContext) {
    return (await this.collect()).results;
  }

  async syncStandings(_context: ProviderContext) {
    return (await this.collect()).standings;
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    try {
      await fetchTextWithPolicy(
        CBF_SERIE_A_2026_ROUND_URL(1),
        {
          headers: {
            accept: 'application/json',
            'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0',
          },
        },
        this.fetchPolicy,
      );
      return { ok: true, checkedAt: new Date().toISOString() };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.name : 'provider error',
      };
    }
  }
}
