import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPETITION_ID = '17';
const SEASON_ID = '285023';
const FIFA_SITE_URL = 'https://www.fifa.com';
const TEAMS_MODULE_URL =
  'https://cxm-api.fifa.com/fifaplusweb/api/sections/teamsModule/4v5Yng3VdGD9c1cpnOIff1?locale=pt&limit=200';
const SQUAD_API_URL = 'https://api.fifa.com/api/v3/teams';
const OUTPUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps',
  'web',
  'src',
  'teamCatalog.ts',
);

const ISO2_BY_CODE = {
  ALG: 'dz',
  ARG: 'ar',
  AUS: 'au',
  AUT: 'at',
  BEL: 'be',
  BIH: 'ba',
  BRA: 'br',
  CAN: 'ca',
  CIV: 'ci',
  COD: 'cd',
  COL: 'co',
  CPV: 'cv',
  CRO: 'hr',
  CUW: 'cw',
  CZE: 'cz',
  ECU: 'ec',
  EGY: 'eg',
  ENG: 'gb',
  ESP: 'es',
  FRA: 'fr',
  GER: 'de',
  GHA: 'gh',
  HAI: 'ht',
  IRN: 'ir',
  IRQ: 'iq',
  JOR: 'jo',
  JPN: 'jp',
  KOR: 'kr',
  KSA: 'sa',
  MAR: 'ma',
  MEX: 'mx',
  NED: 'nl',
  NOR: 'no',
  NZL: 'nz',
  PAN: 'pa',
  PAR: 'py',
  POR: 'pt',
  QAT: 'qa',
  RSA: 'za',
  SCO: 'gb',
  SEN: 'sn',
  SUI: 'ch',
  SWE: 'se',
  TUN: 'tn',
  TUR: 'tr',
  URU: 'uy',
  USA: 'us',
  UZB: 'uz',
};

const POSITION_ORDER = new Map([
  ['Goleiro', 0],
  ['Defensor', 1],
  ['Meio-campista', 2],
  ['Atacante', 3],
]);

function localizedDescription(values, preferredLocale = 'pt-BR') {
  if (!Array.isArray(values)) return null;
  return (
    values.find((value) => value?.Locale === preferredLocale)?.Description ??
    values.find((value) => value?.Locale === 'pt-PT')?.Description ??
    values.find((value) => value?.Locale === 'en-GB')?.Description ??
    values.find((value) => value?.Description)?.Description ??
    null
  );
}

function calculateAge(birthDate, today = new Date()) {
  if (!birthDate) return undefined;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return undefined;

  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayHasPassed =
    today.getUTCMonth() > birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() >= birth.getUTCDate());
  if (!birthdayHasPassed) age -= 1;
  return age;
}

function teamCode(team) {
  const rawCode = team.teamFlag?.split('/').at(-1)?.toUpperCase();
  if (!rawCode || !ISO2_BY_CODE[rawCode]) {
    throw new Error(`Codigo FIFA nao reconhecido para ${team.teamName ?? team.teamId}.`);
  }
  return rawCode;
}

function playerPicture(player) {
  const url = player.PlayerPicture?.PictureUrl;
  if (!url) return undefined;
  return `${url}?io=transform:fill,aspectratio:1x1,width:320,gravity:top&quality=75`;
}

function transformPlayer(player) {
  const position = localizedDescription(player.PositionLocalized) ?? 'Jogador';
  return {
    number: Number.isInteger(player.JerseyNum) ? player.JerseyNum : 0,
    name: localizedDescription(player.PlayerName, 'pt-BR') ?? `Jogador ${player.IdPlayer}`,
    position,
    age: calculateAge(player.BirthDate),
    imageUrl: playerPicture(player),
  };
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'bolao-copa-2026-squad-sync/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`FIFA respondeu ${response.status} para ${url}`);
  }
  return response.json();
}

async function fetchSquad(team) {
  const code = teamCode(team);
  const url = `${SQUAD_API_URL}/${team.teamId}/squad?idCompetition=${COMPETITION_ID}&idSeason=${SEASON_ID}&language=pt`;
  const payload = await getJson(url);
  const players = (payload.Players ?? []).map(transformPlayer).sort((left, right) => {
    const positionDifference =
      (POSITION_ORDER.get(left.position) ?? 9) - (POSITION_ORDER.get(right.position) ?? 9);
    return positionDifference || left.number - right.number || left.name.localeCompare(right.name, 'pt-BR');
  });

  if (players.length === 0) {
    throw new Error(`A FIFA nao retornou jogadores para ${team.teamName} (${code}).`);
  }

  const pagePath = `${team.teamPageUrl}/squad`;
  return {
    code,
    countryName: team.teamName,
    iso2: ISO2_BY_CODE[code],
    sourceLabel: 'Elenco atualizado a partir da lista oficial da FIFA.',
    sourceUrl: `${FIFA_SITE_URL}${pagePath}`,
    players,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function serializeCatalog(entries) {
  const catalog = Object.fromEntries(entries.map((entry) => [entry.code, entry]));
  return `export interface TeamCatalogPlayer {
  number: number;
  name: string;
  position: string;
  age?: number;
  club?: string;
  imageUrl?: string;
}

export interface TeamCatalogEntry {
  code: string;
  countryName: string;
  iso2: string;
  sourceLabel: string;
  sourceUrl: string;
  players: TeamCatalogPlayer[];
}

// Generated by scripts/sync-fifa-squads.mjs from FIFA's official 2026 squad data.
export const teamCatalogByCode: Record<string, TeamCatalogEntry> = ${JSON.stringify(catalog, null, 2)};
`;
}

async function main() {
  const teamsModule = await getJson(TEAMS_MODULE_URL);
  const teams = teamsModule.teams ?? [];
  if (teams.length !== 48) {
    throw new Error(`Esperadas 48 selecoes, mas a FIFA retornou ${teams.length}.`);
  }

  const entries = await mapWithConcurrency(teams, 6, async (team) => {
    const entry = await fetchSquad(team);
    process.stdout.write(`${entry.code}: ${entry.players.length} jogadores\n`);
    return entry;
  });

  await writeFile(OUTPUT_FILE, serializeCatalog(entries), 'utf8');
  const totalPlayers = entries.reduce((total, entry) => total + entry.players.length, 0);
  process.stdout.write(`Catalogo salvo com ${entries.length} selecoes e ${totalPlayers} jogadores.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
