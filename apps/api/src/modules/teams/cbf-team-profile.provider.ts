import { z } from 'zod';
import {
  teamAthleteDtoSchema,
  teamMatchHistoryDtoSchema,
  teamStatisticsDtoSchema,
  type TeamAthleteDto,
  type TeamMatchHistoryDto,
  type TeamStatisticsDto,
} from '@bolao/shared';
import { fetchTextWithPolicy, type FetchTextPolicy } from '../../http/fetch-policy.js';
import { parseCbfLocalStartsAt } from '../providers/adapters/cbf-serie-a-2026.provider.js';
import { checksum } from '../providers/provider-utils.js';

export const CBF_SERIE_A_2026_TEAMS_URL =
  'https://www.cbf.com.br/futebol-brasileiro/times/campeonato-brasileiro/serie-a/2026';
export const CBF_SERIE_A_2026_TEAM_URL = (externalTeamId: string) => {
  if (!/^\d{1,10}$/.test(externalTeamId)) throw new Error('Invalid CBF team identifier.');
  return `${CBF_SERIE_A_2026_TEAMS_URL}/${externalTeamId}`;
};

const PROFILE_FETCH_POLICY = {
  timeoutMs: 10_000,
  maxBytes: 384 * 1024,
  retries: 2,
} as const;

const rawTeamSchema = z
  .object({
    time_id: z.string().trim().regex(/^\d+$/),
    time_nome: z.string().trim().min(1).max(180),
    time_uf: z.string().trim().length(2),
  })
  .passthrough();

const rawStatisticsSchema = z
  .object({
    gols_feitos: z.string(),
    gols_sofridos: z.string(),
    jogos_sem_sofrer_gol: z.string(),
    jogos_disputados: z.string(),
    vitorias: z.string(),
    derrotas: z.string(),
    empates: z.string(),
    cartoes_amarelos: z.string(),
    cartoes_vermelhos: z.string(),
  })
  .passthrough();

const rawMatchSideSchema = z
  .object({
    id: z.string().trim().regex(/^\d+$/),
    nome: z.string().trim().min(1).max(180),
    gols: z
      .string()
      .trim()
      .regex(/^\d{1,2}$/),
  })
  .passthrough();

const rawMatchSchema = z
  .object({
    id_jogo: z.string().trim().regex(/^\d+$/),
    num_jogo: z.string().trim().min(1).max(40),
    rodada: z
      .string()
      .trim()
      .regex(/^\d{1,2}$/),
    mandante: rawMatchSideSchema,
    visitante: rawMatchSideSchema,
    local: z.string().trim().min(1).max(220),
    data: z.string().trim().min(1).max(40),
    hora: z.string().trim().min(1).max(20),
  })
  .passthrough();

const rawAthleteSchema = z
  .object({
    atleta_id: z.string().trim().regex(/^\d+$/),
    atleta_nome: z.string().trim().min(1).max(180),
    Atleta_apelido: z.string().nullable().optional(),
    clube_nome_popular: z.string().trim().min(1).max(180),
    clube_uf: z.string().trim().length(2).nullable().optional(),
    clube_id: z.union([z.string().trim().regex(/^\d+$/), z.number().int().positive()]).nullable(),
  })
  .passthrough();

const rawProfileSchema = z
  .object({
    time: z.array(rawTeamSchema).length(1),
    estatisticas: z.array(rawStatisticsSchema).length(1),
    jogos: z.array(rawMatchSchema).max(38),
    atletas: z.array(rawAthleteSchema).max(150),
  })
  .passthrough();

function nonNegativeInteger(value: string, field: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`CBF profile ${field} is invalid.`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`CBF profile ${field} is outside the supported range.`);
  }
  return parsed;
}

function balancedJsonObject(value: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  throw new Error('CBF profile RSC object is incomplete.');
}

function extractProfileData(html: string) {
  const marker = '{"data":{"campeonato":';
  const scripts = html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g);
  for (const script of scripts) {
    let flight: unknown;
    try {
      flight = JSON.parse(script[1] ?? '');
    } catch {
      continue;
    }
    if (!Array.isArray(flight) || flight[0] !== 1 || typeof flight[1] !== 'string') continue;
    const start = flight[1].indexOf(marker);
    if (start < 0) continue;
    const wrapper = JSON.parse(balancedJsonObject(flight[1], start)) as { data?: unknown };
    return rawProfileSchema.parse(wrapper.data);
  }
  throw new Error('CBF profile data was not found in the server-rendered response.');
}

export interface ParsedCbfTeamProfile {
  externalTeamId: string;
  name: string;
  state: string;
  athletes: TeamAthleteDto[];
  matches: TeamMatchHistoryDto[];
  statistics: TeamStatisticsDto;
}

export function parseCbfTeamProfile(html: string, expectedExternalTeamId: string) {
  const profile = extractProfileData(html);
  const team = profile.time[0]!;
  if (team.time_id !== expectedExternalTeamId) {
    throw new Error(
      `CBF profile returned team ${team.time_id} instead of ${expectedExternalTeamId}.`,
    );
  }

  const rawStats = profile.estatisticas[0]!;
  const statistics = teamStatisticsDtoSchema.parse({
    goalsFor: nonNegativeInteger(rawStats.gols_feitos, 'gols_feitos'),
    goalsAgainst: nonNegativeInteger(rawStats.gols_sofridos, 'gols_sofridos'),
    cleanSheets: nonNegativeInteger(rawStats.jogos_sem_sofrer_gol, 'jogos_sem_sofrer_gol'),
    played: nonNegativeInteger(rawStats.jogos_disputados, 'jogos_disputados'),
    wins: nonNegativeInteger(rawStats.vitorias, 'vitorias'),
    draws: nonNegativeInteger(rawStats.empates, 'empates'),
    losses: nonNegativeInteger(rawStats.derrotas, 'derrotas'),
    yellowCards: nonNegativeInteger(rawStats.cartoes_amarelos, 'cartoes_amarelos'),
    redCards: nonNegativeInteger(rawStats.cartoes_vermelhos, 'cartoes_vermelhos'),
  });
  if (statistics.played !== statistics.wins + statistics.draws + statistics.losses) {
    throw new Error('CBF profile statistics do not satisfy played = wins + draws + losses.');
  }

  const athleteIds = new Set<string>();
  const athletes = profile.atletas.map((athlete) => {
    if (athleteIds.has(athlete.atleta_id))
      throw new Error('CBF profile contains duplicate athletes.');
    athleteIds.add(athlete.atleta_id);
    const nickname = athlete.Atleta_apelido?.trim() || null;
    return teamAthleteDtoSchema.parse({
      externalId: athlete.atleta_id,
      fullName: athlete.atleta_nome,
      nickname,
      currentClub: {
        externalId: athlete.clube_id == null ? null : String(athlete.clube_id),
        name: athlete.clube_nome_popular,
        state: athlete.clube_uf ?? null,
      },
    });
  });

  const matchIds = new Set<string>();
  const matches = profile.jogos.map((match) => {
    if (matchIds.has(match.id_jogo)) throw new Error('CBF profile contains duplicate matches.');
    matchIds.add(match.id_jogo);
    if (match.mandante.id !== team.time_id && match.visitante.id !== team.time_id) {
      throw new Error(`CBF match ${match.id_jogo} does not contain the requested team.`);
    }
    const startsAt = parseCbfLocalStartsAt(match.data, match.hora);
    if (!startsAt) throw new Error(`CBF match ${match.id_jogo} has an invalid start time.`);
    const homeScore = nonNegativeInteger(match.mandante.gols, 'mandante.gols');
    const awayScore = nonNegativeInteger(match.visitante.gols, 'visitante.gols');
    const selectedScore = match.mandante.id === team.time_id ? homeScore : awayScore;
    const opponentScore = match.mandante.id === team.time_id ? awayScore : homeScore;
    return teamMatchHistoryDtoSchema.parse({
      externalId: match.id_jogo,
      reference: match.num_jogo,
      round: nonNegativeInteger(match.rodada, 'rodada'),
      startsAt,
      home: { externalId: match.mandante.id, name: match.mandante.nome, score: homeScore },
      away: { externalId: match.visitante.id, name: match.visitante.nome, score: awayScore },
      venue: match.local,
      result:
        selectedScore > opponentScore ? 'WIN' : selectedScore < opponentScore ? 'LOSS' : 'DRAW',
    });
  });
  if (matches.length !== statistics.played) {
    throw new Error('CBF profile match history does not match the reported games played.');
  }

  return {
    externalTeamId: team.time_id,
    name: team.time_nome,
    state: team.time_uf,
    athletes: athletes.sort((left, right) =>
      (left.nickname ?? left.fullName).localeCompare(right.nickname ?? right.fullName, 'pt-BR'),
    ),
    matches: matches.sort((left, right) => right.startsAt.localeCompare(left.startsAt)),
    statistics,
  } satisfies ParsedCbfTeamProfile;
}

export interface CollectedCbfTeamProfile extends ParsedCbfTeamProfile {
  sourceUrl: string;
  collectedAt: string;
  checksum: string;
}

export async function collectCbfTeamProfile(
  externalTeamId: string,
  policy: FetchTextPolicy = PROFILE_FETCH_POLICY,
): Promise<CollectedCbfTeamProfile> {
  const sourceUrl = CBF_SERIE_A_2026_TEAM_URL(externalTeamId);
  const html = await fetchTextWithPolicy(
    sourceUrl,
    {
      headers: {
        accept: 'text/html',
        'user-agent': 'BolaoSirel-CBF-TeamProfile-Reconciler/1.0',
      },
    },
    policy,
  );
  const profile = parseCbfTeamProfile(html, externalTeamId);
  return {
    ...profile,
    sourceUrl,
    collectedAt: new Date().toISOString(),
    checksum: checksum(profile),
  };
}
