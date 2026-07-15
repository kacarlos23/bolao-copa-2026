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
  type NormalizedTeam,
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
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
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_BA_sica_Brasileiro_SA_rie_A_2026_d64996b4d8.pdf';
export const CBF_SERIE_A_2026_REGULATION_URL =
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Brasileiro_SA_rie_A_2026_v15_12_2025_final_02692c1077.pdf';
export const CBF_SERIE_A_2026_ROUND_URL = (round: number) =>
  `https://www.cbf.com.br/api/cbf/jogos/campeonato/${CBF_SERIE_A_2026_COMPETITION_ID}/rodada/${round}/fase/${CBF_SERIE_A_2026_PHASE_ID}`;

const CBF_POLICY = {
  timeoutMs: 10_000,
  maxBytes: 512 * 1024,
  retries: 2,
} as const;

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

export function parseCbfSerieA2026Round(payload: string, expectedRound: number): CbfRoundParseResult {
  const projected = projectRoundPayload(JSON.parse(payload));
  const games = projected.groups.flatMap((group) => group.games).map((game) =>
    projectGame(game, expectedRound),
  );
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
  evidence: CbfSerieA2026Evidence;
}

export class CbfSerieA2026Provider implements CompetitionDataProvider {
  readonly name = 'cbf-official';
  readonly source = CBF_SERIE_A_2026_TABLE_URL;
  private collected?: Promise<CbfCollection>;

  constructor(private readonly fetchPolicy: FetchTextPolicy = CBF_POLICY) {}

  private collect() {
    this.collected ??= this.collectOnce();
    return this.collected;
  }

  private async collectOnce(): Promise<CbfCollection> {
    const collectedAt = new Date().toISOString();
    const documents = await Promise.all(
      [
        { kind: 'BASIC_TABLE' as const, url: CBF_SERIE_A_2026_BASIC_TABLE_URL },
        { kind: 'REGULATION' as const, url: CBF_SERIE_A_2026_REGULATION_URL },
      ].map(async (document) => {
        const bytes = await fetchBytesWithPolicy(
          document.url,
          {
            headers: {
              accept: 'application/pdf',
              'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0',
            },
          },
          { ...this.fetchPolicy, maxBytes: Math.max(this.fetchPolicy.maxBytes, 5 * 1024 * 1024) },
        );
        return {
          ...document,
          checksum: checksum(bytes.toString('base64')),
          bytes: bytes.byteLength,
          collectedAt,
        };
      }),
    );
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
    };
    return {
      ...collection,
      evidence: {
        source: this.source,
        collectedAt,
        timezone: 'America/Sao_Paulo',
        checksum: checksum({ collection, documents }),
        roundsFetched: payloads.length,
        rawMatches,
        reconciledMatches: collection.schedule.length,
        unscheduledMatches,
        finishedResults: collection.results.length,
        teams: collection.teams.length,
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
