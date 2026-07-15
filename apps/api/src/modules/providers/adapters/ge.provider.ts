import { z } from 'zod';
import { fetchTextWithPolicy, type FetchTextPolicy } from '../../../http/fetch-policy.js';
import {
  type CompetitionDataProvider,
  normalizeEntityName,
  type NormalizedMatch,
  type NormalizedResult,
  type NormalizedTeam,
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedTeamArraySchema,
  type ProviderContext,
  type ProviderHealth,
} from '../competition-data-provider.js';

export const GE_COPA_URL = 'https://ge.globo.com/futebol/copa-do-mundo/';
export const GE_PROVIDER_URLS = ['https://ge.globo.com/', GE_COPA_URL] as const;
const GE_POLICY = { timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024, retries: 2 } as const;

const projectedGeMatchSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    startsAt: z.string().optional(),
    homeTeam: z.string().min(1),
    awayTeam: z.string().min(1),
    started: z.boolean().optional(),
    homeScore: z.number().int().nonnegative().nullable().optional(),
    awayScore: z.number().int().nonnegative().nullable().optional(),
    status: z.string().optional(),
  })
  .strict();

function extractArraysAfterProperty(html: string, property: string) {
  const arrays: unknown[][] = [];
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const propertyIndex = html.indexOf(property, searchFrom);
    if (propertyIndex === -1) break;
    const start = html.indexOf('[', propertyIndex + property.length);
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let advanced = false;
    for (let index = start; index < html.length; index += 1) {
      const character = html[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '[') depth += 1;
      else if (character === ']') {
        depth -= 1;
        if (depth !== 0) continue;
        try {
          const value = JSON.parse(html.slice(start, index + 1));
          if (Array.isArray(value)) arrays.push(value);
        } catch {
          // The page also contains non-JSON script fragments; only valid arrays are candidates.
        }
        searchFrom = index + 1;
        advanced = true;
        break;
      }
    }
    if (!advanced) searchFrom = propertyIndex + property.length;
  }
  return arrays;
}

function dateWithGeTimezone(value?: string) {
  if (!value) return undefined;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}-03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function geStatus(raw: Record<string, unknown>) {
  const transmission = raw.transmissao as Record<string, unknown> | undefined;
  const broadcast = transmission?.broadcast as Record<string, unknown> | undefined;
  const value = normalizeEntityName(
    [raw.status, broadcast?.id, broadcast?.label, transmission?.label]
      .filter((item): item is string => typeof item === 'string')
      .join(' '),
  );
  if (/encerrad|fim de jogo|finalizad/.test(value)) return 'FINISHED' as const;
  if (/adiad/.test(value)) return 'POSTPONED' as const;
  if (/cancelad/.test(value)) return 'CANCELLED' as const;
  if (raw.jogo_ja_comecou === true || /ao vivo|andamento|intervalo/.test(value)) {
    return 'LIVE' as const;
  }
  return 'SCHEDULED' as const;
}

function projectGeMatch(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const teams = value.equipes as Record<string, unknown> | undefined;
  const home = teams?.mandante as Record<string, unknown> | undefined;
  const away = teams?.visitante as Record<string, unknown> | undefined;
  const homeTeam = home?.nome_popular;
  const awayTeam = away?.nome_popular;
  if (typeof homeTeam !== 'string' || typeof awayTeam !== 'string') return null;
  return projectedGeMatchSchema.parse({
    id: value.id ?? value.jogo_id ?? value.match_id,
    startsAt: typeof value.data_realizacao === 'string' ? value.data_realizacao : undefined,
    homeTeam,
    awayTeam,
    started: typeof value.jogo_ja_comecou === 'boolean' ? value.jogo_ja_comecou : undefined,
    homeScore:
      typeof value.placar_oficial_mandante === 'number'
        ? value.placar_oficial_mandante
        : value.placar_oficial_mandante === null
          ? null
          : undefined,
    awayScore:
      typeof value.placar_oficial_visitante === 'number'
        ? value.placar_oficial_visitante
        : value.placar_oficial_visitante === null
          ? null
          : undefined,
    status: geStatus(value),
  });
}

function teamExternalId(name: string) {
  return `team:${normalizeEntityName(name).replace(/\s+/g, '-')}`;
}

function matchExternalId(match: z.infer<typeof projectedGeMatchSchema>) {
  if (match.id !== undefined) return `match:${String(match.id)}`;
  return `match:${normalizeEntityName(match.homeTeam).replace(/\s+/g, '-')}:${normalizeEntityName(match.awayTeam).replace(/\s+/g, '-')}`;
}

export function parseGeProviderHtml(html: string) {
  const parsed = extractArraysAfterProperty(html, '"lista_jogos"')
    .flat()
    .map(projectGeMatch)
    .filter((match): match is NonNullable<typeof match> => Boolean(match));
  const schedule: NormalizedMatch[] = [];
  const results: NormalizedResult[] = [];
  const teams = new Map<string, NormalizedTeam>();

  for (const match of parsed) {
    const startsAt = dateWithGeTimezone(match.startsAt);
    if (!startsAt) continue;
    const externalId = matchExternalId(match);
    const homeTeamExternalId = teamExternalId(match.homeTeam);
    const awayTeamExternalId = teamExternalId(match.awayTeam);
    teams.set(homeTeamExternalId, { externalId: homeTeamExternalId, name: match.homeTeam });
    teams.set(awayTeamExternalId, { externalId: awayTeamExternalId, name: match.awayTeam });
    schedule.push({
      externalId,
      homeTeamExternalId,
      awayTeamExternalId,
      homeTeamName: match.homeTeam,
      awayTeamName: match.awayTeam,
      startsAt,
      status: match.status as NormalizedMatch['status'],
    });
    if (match.homeScore !== null && match.homeScore !== undefined && match.awayScore != null) {
      results.push({
        externalId: `result:${externalId}`,
        matchExternalId: externalId,
        homeTeamExternalId,
        awayTeamExternalId,
        homeTeamName: match.homeTeam,
        awayTeamName: match.awayTeam,
        startsAt,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        status: match.status as NormalizedResult['status'],
      });
    }
  }

  return {
    teams: normalizedTeamArraySchema.parse([...teams.values()]),
    schedule: normalizedMatchArraySchema.parse(schedule),
    results: normalizedResultArraySchema.parse(results),
  };
}

export class GeProvider implements CompetitionDataProvider {
  readonly name = 'ge';
  readonly source = GE_COPA_URL;
  private collected?: Promise<{
    teams: NormalizedTeam[];
    schedule: NormalizedMatch[];
    results: NormalizedResult[];
  }>;

  constructor(
    private readonly fetchPolicy: FetchTextPolicy = GE_POLICY,
    private readonly urls: readonly string[] = GE_PROVIDER_URLS,
  ) {}

  private collect() {
    if (this.collected) return this.collected;
    this.collected = this.collectOnce();
    return this.collected;
  }

  private async collectOnce() {
    const merged = {
      teams: new Map<string, NormalizedTeam>(),
      schedule: new Map<string, NormalizedMatch>(),
      results: new Map<string, NormalizedResult>(),
    };
    for (const url of this.urls) {
      const html = await fetchTextWithPolicy(
        url,
        { headers: { 'user-agent': 'BolaoCopa2026/1.0' } },
        this.fetchPolicy,
      );
      const batch = parseGeProviderHtml(html);
      for (const team of batch.teams) merged.teams.set(team.externalId, team);
      for (const match of batch.schedule) merged.schedule.set(match.externalId, match);
      for (const result of batch.results) merged.results.set(result.externalId, result);
    }
    return {
      teams: [...merged.teams.values()],
      schedule: [...merged.schedule.values()],
      results: [...merged.results.values()],
    };
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
        GE_COPA_URL,
        { headers: { 'user-agent': 'BolaoCopa2026/1.0' } },
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
