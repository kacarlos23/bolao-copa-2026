import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBytesWithPolicy } from '../http/fetch-policy.js';
import { normalizeEntityName } from '../modules/providers/competition-data-provider.js';
import {
  computeOfficialSnapshotChecksum,
  parseOfficialSourceSnapshot,
} from '../modules/providers/official-source-snapshot.js';

const FIXTURES_URL = 'https://gol.conmebol.com/libertadores/es/api/v2/tournament-fixtures/15';
const TABLE_URL = 'https://gol.conmebol.com/libertadores/es/tournament-table/15';
const MANUAL_PAGE_URL =
  'https://www.conmebol.com/documentos/manual-de-clubes-conmebol-libertadores-2026/';
const MANUAL_PDF_URL =
  'https://cdn.conmebol.com/wp-content/uploads/2025/12/CL-2026-Manual-de-Clubes-ESP-Feb26.pdf';
const GROUPS_URL =
  'https://gol.conmebol.com/libertadores/es/news/rumbo-la-gloria-eterna-asi-quedaron-los-grupos-de-la-conmebol-libertadores-2026';
const GROUP_SCHEDULE_URL =
  'https://gol.conmebol.com/libertadores/es/news/calendario-conmebol-libertadores-2026-dias-horarios-y-sedes-de-la-fase-de-grupos';
const QUALIFIED_URL =
  'https://gol.conmebol.com/libertadores/es/news/la-conmebol-libertadores-2026-ya-tiene-sus-protagonistas-para-octavos';
const ROUND_OF_16_URL =
  'https://gol.conmebol.com/libertadores/es/news/asi-se-disputaran-los-octavos-de-final-de-la-conmebol-libertadores';
const ROUND_OF_16_SCHEDULE_URL =
  'https://gol.conmebol.com/libertadores/es/news/fechas-y-horarios-asi-se-jugaran-los-octavos-de-final-de-la-conmebol-libertadores';
const ROUND_OF_16_PDF_URL =
  'https://www.conmebol.com/wp-content/uploads/2026/06/Fixture_8vos-de-Final_CONMEBOL-Libertadores-2026_5.6.2026-1.pdf';
const FINAL_URL =
  'https://gol.conmebol.com/libertadores/es/news/la-final-de-la-conmebol-libertadores-2026-se-disputara-en-montevideo';
const DEFAULT_OUTPUT = resolve(
  'src/modules/providers/__fixtures__/official/conmebol-libertadores-2026.sanitized.json',
);

type JsonRecord = Record<string, any>;
type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';

const preliminaryRounds = [
  { stageName: '1st Round', externalId: 'round:preliminary-1', name: 'Fase 1', order: 1 },
  { stageName: '2nd Round', externalId: 'round:preliminary-2', name: 'Fase 2', order: 2 },
  { stageName: '3rd Round', externalId: 'round:preliminary-3', name: 'Fase 3', order: 3 },
] as const;

const roundOf16Pairings = [
  ['Fluminense', 'Independiente Rivadavia'],
  ['Estudiantes', 'Universidad Católica'],
  ['Deportes Tolima', 'Independiente Valle'],
  ['Platense', 'Coquimbo Unido'],
  ['Palmeiras', 'Cerro Porteño'],
  ['Cruzeiro', 'Flamengo'],
  ['Mirassol', 'LDU Quito'],
  ['Rosario Central', 'Corinthians'],
] as const;

// The official match feed exposes a stable club ID but omits association and
// country on contestant objects. These values are pinned from the 2026 Club
// Manual and the official group/preliminary publications collected below.
const clubAssociations: Record<string, { countryCode: string; federation: string }> = {
  '102ykb145wz6dtveg65nistwm': { countryCode: 'BRA', federation: 'CBF' },
  '19ij50t7wklqr3w2bye5r7tp4': { countryCode: 'ARG', federation: 'AFA' },
  '1p2mbne1t0rwtj3go5f5z98pu': { countryCode: 'URY', federation: 'AUF' },
  '27ia8tgma24uc864wpnbdwoxo': { countryCode: 'URY', federation: 'AUF' },
  '2ldx5vhhqfz2rllkgp7wpa744': { countryCode: 'BRA', federation: 'CBF' },
  '2x94b2pn1o1tb5l1bbu8x9yu9': { countryCode: 'BRA', federation: 'CBF' },
  '50127xit7gxvh20pvvv2lyh0r': { countryCode: 'ECU', federation: 'FEF' },
  '52pduyh1bfri4d8rv9qby5brp': { countryCode: 'COL', federation: 'FCF' },
  '5c5d19bkze3zaw4900a9hoy6q': { countryCode: 'PER', federation: 'FPF' },
  '5qf0x98stttvyaav031v00ao4': { countryCode: 'PER', federation: 'FPF' },
  '5vtngmqlfpmuntxl9fw683ttc': { countryCode: 'COL', federation: 'FCF' },
  '7esunfo4e4xihd0h83euabeox': { countryCode: 'PER', federation: 'FPF' },
  '7gkwmrw0cjz0m168ouw00z4gy': { countryCode: 'CHL', federation: 'FFCH' },
  '7gw3xbwn1ymmmbenycb1q7d5v': { countryCode: 'VEN', federation: 'FVF' },
  '7tev5pifn8hdy4vlts0coha1b': { countryCode: 'ARG', federation: 'AFA' },
  '7yxslrj734ntqcgb9d6bu02m4': { countryCode: 'URY', federation: 'AUF' },
  '85tqel61vdk8sfz1vsb1jykk7': { countryCode: 'ECU', federation: 'FEF' },
  '8inprqnxjps9ckiamn3cfoo8v': { countryCode: 'ARG', federation: 'AFA' },
  '8j13r6l93c46v57ekr68obhoz': { countryCode: 'PAR', federation: 'APF' },
  '8rpjhpm2j1q7p40zfmlqpj8am': { countryCode: 'CHL', federation: 'FFCH' },
  '8wcbo8lv6tm0yvv7sa0do4ojb': { countryCode: 'URY', federation: 'AUF' },
  '91j32z6ga16tjj140ss2i24mt': { countryCode: 'ARG', federation: 'AFA' },
  '984ibdjplnlwb36kt6wbgwe97': { countryCode: 'PAR', federation: 'APF' },
  ai0pkwqf76czud754b5vrmwbe: { countryCode: 'BOL', federation: 'FBF' },
  b9d2xcvxxcwplyp4le9ulnlv9: { countryCode: 'BRA', federation: 'CBF' },
  bd6vujl7jfv4wtc8gvo1o1t5y: { countryCode: 'BRA', federation: 'CBF' },
  buyj9j0qwgbvx3v8wzikpjyzu: { countryCode: 'PAR', federation: 'APF' },
  bw2py3aiws1rq61pokete3kv2: { countryCode: 'CHL', federation: 'FFCH' },
  by2oauw9w521ognfw0mg5ixfc: { countryCode: 'BOL', federation: 'FBF' },
  bzpygd5fja0tbb2x8daphil1l: { countryCode: 'COL', federation: 'FCF' },
  c42bnpk0mz0j3nyf2zoo992ks: { countryCode: 'PAR', federation: 'APF' },
  c809db63irass4isclyicm3t1: { countryCode: 'VEN', federation: 'FVF' },
  ciqt22ivoc48zj62detdyh1mm: { countryCode: 'ARG', federation: 'AFA' },
  cllomrn9h2sg6vmxy0pdnmups: { countryCode: 'BRA', federation: 'CBF' },
  cpqaizhc99tbsqm6h2cgampio: { countryCode: 'CHL', federation: 'FFCH' },
  cxb4hqite921i36gwrezdts7c: { countryCode: 'ECU', federation: 'FEF' },
  d08q2rnrt7mss1axbuu595tyu: { countryCode: 'ARG', federation: 'AFA' },
  d0rpwl0d5v0nacrmgog65zfo2: { countryCode: 'VEN', federation: 'FVF' },
  ddkiejug4w4ri9ch2fnnen6yw: { countryCode: 'ECU', federation: 'FEF' },
  dj7mlv2txjphj4xtannqj8q6z: { countryCode: 'BOL', federation: 'FBF' },
  dpzg67jk1bxbhjo13o2lpem1q: { countryCode: 'BOL', federation: 'FBF' },
  dv7t1octbjjnwsp3vlns10n8c: { countryCode: 'PER', federation: 'FPF' },
  e8ma1lonj51sqmwy00mwnw1ke: { countryCode: 'ARG', federation: 'AFA' },
  e93fgat6j6g86zqul1m3m2kpn: { countryCode: 'BRA', federation: 'CBF' },
  em31nnti82q57le3wp7g5lsrj: { countryCode: 'VEN', federation: 'FVF' },
  epcjkyn8gazuywbotxwikc5kn: { countryCode: 'COL', federation: 'FCF' },
  f0td6lvs326lppbwh1fj8v2ls: { countryCode: 'BRA', federation: 'CBF' },
};

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function localCollectedAt(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-03:00`;
}

async function fetchArtifact(source: string, kind: 'PAGE' | 'PDF' | 'RESPONSE') {
  const bytes = await fetchBytesWithPolicy(
    source,
    {
      headers: {
        accept: kind === 'PDF' ? 'application/pdf' : '*/*',
        'user-agent': 'bolao-copa-2026-official-source-collector/1.0',
      },
    },
    { timeoutMs: 20_000, maxBytes: 16 * 1024 * 1024, retries: 2 },
  );
  return {
    artifact: {
      kind,
      source,
      contentType:
        kind === 'PDF' ? 'application/pdf' : kind === 'RESPONSE' ? 'application/json' : 'text/html',
      retention: 'CHECKSUM_ONLY' as const,
      checksum: sha256(bytes),
      byteLength: bytes.byteLength,
    },
    bytes,
  };
}

function statusOf(match: JsonRecord): MatchStatus {
  const status = match.liveData?.matchStatus;
  if (status === 'Played' || status === 'Awarded') return 'FINISHED';
  if (status === 'Playing' || match.liveData?.isLive) return 'LIVE';
  if (status === 'Postponed') return 'POSTPONED';
  if (status === 'Cancelled') return 'CANCELLED';
  return 'SCHEDULED';
}

function teamPair(match: JsonRecord) {
  const contestants = match.matchInfo.contestant as JsonRecord[];
  const home = contestants.find((team) => team.position === 'home') ?? contestants[0];
  const away = contestants.find((team) => team.position === 'away') ?? contestants[1];
  return { home, away };
}

function groupRound(iso: string) {
  const key = iso.slice(5, 10);
  if (key >= '04-07' && key <= '04-10') return 1;
  if (key >= '04-14' && key <= '04-17') return 2;
  if (key >= '04-28' && key <= '05-01') return 3;
  if (key >= '05-05' && key <= '05-08') return 4;
  if (key >= '05-19' && key <= '05-22') return 5;
  if (key >= '05-26' && key <= '05-29') return 6;
  throw new Error(`Group match outside the six official windows: ${iso}.`);
}

function officialWindow(matches: JsonRecord[]) {
  const dates = matches.map((match) => new Date(match.matchInfo.date * 1000).toISOString()).sort();
  return dates.length ? { startsAt: dates.at(0), endsAt: dates.at(-1) } : {};
}

function officialRoundStatus(matches: JsonRecord[]) {
  if (matches.length && matches.every((match) => statusOf(match) === 'FINISHED')) return 'FINISHED';
  if (matches.some((match) => ['LIVE', 'FINISHED'].includes(statusOf(match)))) return 'ACTIVE';
  return 'SCHEDULED';
}

function normalizedPairKey(match: JsonRecord) {
  return (match.matchInfo.contestant as JsonRecord[])
    .map((team) => team.externalId as string)
    .sort()
    .join(':');
}

function groupTies(matches: JsonRecord[]) {
  const grouped = new Map<string, JsonRecord[]>();
  for (const match of matches) {
    const key = normalizedPairKey(match);
    const entries = grouped.get(key) ?? [];
    entries.push(match);
    grouped.set(key, entries);
  }
  return [...grouped.entries()].map(([key, entries]) => [
    key,
    entries.sort((left, right) => left.matchInfo.date - right.matchInfo.date),
  ]) as Array<[string, JsonRecord[]]>;
}

function decidedTie(legs: JsonRecord[]) {
  if (legs.length !== 2 || !legs.every((match) => statusOf(match) === 'FINISHED')) return null;
  const totals = new Map<string, number>();
  for (const leg of legs) {
    const { home, away } = teamPair(leg);
    totals.set(home.externalId, (totals.get(home.externalId) ?? 0) + leg.liveData.home_score);
    totals.set(away.externalId, (totals.get(away.externalId) ?? 0) + leg.liveData.away_score);
  }
  const lastLeg = legs.at(-1)!;
  const penalties = lastLeg.liveData?.scoreEntries?.pen;
  const lastPair = teamPair(lastLeg);
  const winnerFromLastMatch =
    lastLeg.liveData?.match_winner === 'home'
      ? lastPair.home.externalId
      : lastLeg.liveData?.match_winner === 'away'
        ? lastPair.away.externalId
        : undefined;
  const winnerFromPenalties = penalties
    ? penalties.home_score > penalties.away_score
      ? lastPair.home.externalId
      : penalties.away_score > penalties.home_score
        ? lastPair.away.externalId
        : undefined
    : undefined;
  const [teamAId, teamBId] = [...totals.keys()];
  const winnerTeamExternalId = penalties
    ? winnerFromPenalties
    : totals.get(teamAId)! > totals.get(teamBId)!
      ? teamAId
      : totals.get(teamBId)! > totals.get(teamAId)!
        ? teamBId
        : winnerFromLastMatch;
  if (!winnerTeamExternalId) throw new Error('Finished official tie has no decision.');
  return {
    winnerTeamExternalId,
    decisionMethod: penalties ? ('PENALTIES' as const) : ('AGGREGATE' as const),
  };
}

function pairingMatches(matches: JsonRecord[], expected: readonly [string, string]) {
  return matches.filter((match) => {
    const actual = (match.matchInfo.contestant as JsonRecord[]).map((team) =>
      normalizeEntityName(team.name),
    );
    return expected.every((name) => actual.includes(normalizeEntityName(name)));
  });
}

export async function collectLibertadores2026Snapshot() {
  const sourceSpecs = [
    [MANUAL_PAGE_URL, 'PAGE'],
    [MANUAL_PDF_URL, 'PDF'],
    [GROUPS_URL, 'PAGE'],
    [GROUP_SCHEDULE_URL, 'PAGE'],
    [FIXTURES_URL, 'RESPONSE'],
    [TABLE_URL, 'PAGE'],
    [QUALIFIED_URL, 'PAGE'],
    [ROUND_OF_16_URL, 'PAGE'],
    [ROUND_OF_16_SCHEDULE_URL, 'PAGE'],
    [ROUND_OF_16_PDF_URL, 'PDF'],
    [FINAL_URL, 'PAGE'],
  ] as const;
  const fetched = await Promise.all(sourceSpecs.map(([url, kind]) => fetchArtifact(url, kind)));
  const fixturesBytes = fetched[sourceSpecs.findIndex(([url]) => url === FIXTURES_URL)].bytes;
  const tableBytes = fetched[sourceSpecs.findIndex(([url]) => url === TABLE_URL)].bytes;
  const fixturePayload = JSON.parse(Buffer.from(fixturesBytes).toString('utf8')) as JsonRecord;
  const matches = fixturePayload.match as JsonRecord[];
  const tableHtml = Buffer.from(tableBytes).toString('utf8');
  const outletKey = tableHtml.match(/outletAuthKey":"([a-z0-9]+)"/)?.[1];
  const externalIds = [...tableHtml.matchAll(/field_cc_external_id":"([a-z0-9]+)"/g)].map(
    (match) => match[1],
  );
  const calendarId = externalIds[1];
  if (!outletKey || !calendarId) throw new Error('Official standings configuration was not found.');
  const standingsUrl = `https://api.performfeeds.com/soccerdata/standings/${outletKey}?_rt=c&_fmt=json&_lcl=es&tmcl=${calendarId}&type=total`;
  const standingsBytes = await fetchBytesWithPolicy(
    standingsUrl,
    {
      headers: {
        origin: 'https://gol.conmebol.com',
        referer: TABLE_URL,
        'user-agent': 'Mozilla/5.0',
      },
    },
    { timeoutMs: 10_000, maxBytes: 1024 * 1024, retries: 2 },
  );
  const standingsPayload = JSON.parse(Buffer.from(standingsBytes).toString('utf8')) as JsonRecord;
  const artifacts = [
    ...fetched.map(({ artifact }) => artifact),
    {
      kind: 'RESPONSE' as const,
      source: standingsUrl,
      contentType: 'application/json',
      retention: 'CHECKSUM_ONLY' as const,
      checksum: sha256(standingsBytes),
      byteLength: standingsBytes.byteLength,
    },
  ];

  const divisions = standingsPayload.stage?.[0]?.division as JsonRecord[];
  if (!Array.isArray(divisions) || divisions.length !== 8) {
    throw new Error('Official standings did not contain eight groups.');
  }
  const groupByTeam = new Map<string, string>();
  for (const division of divisions) {
    const groupName = String(division.groupName).replace(/^Grupo\s+/i, '');
    for (const row of division.ranking as JsonRecord[])
      groupByTeam.set(row.contestantId, groupName);
  }

  const concreteMatches = matches.filter((match) => {
    const contestants = match.matchInfo.contestant as JsonRecord[];
    return (
      contestants.length === 2 &&
      contestants.every((team) => team.externalId && team.name !== 'Unknown')
    );
  });
  const teamRecords = new Map<string, JsonRecord>();
  for (const match of concreteMatches) {
    for (const team of match.matchInfo.contestant as JsonRecord[])
      teamRecords.set(team.externalId, team);
  }
  const thirdPlacedIds = new Set(
    divisions.flatMap((division) =>
      (division.ranking as JsonRecord[])
        .filter((row) => row.rank === 3)
        .map((row) => row.contestantId as string),
    ),
  );
  const teams = [...teamRecords.values()]
    .map((team) => {
      const association = clubAssociations[team.externalId];
      if (!association) throw new Error(`Club Manual association missing for ${team.name}.`);
      return {
        externalId: team.externalId,
        name: team.name,
        code: team.code,
        type: 'CLUB' as const,
        crestUrl: team.crest?.uri_1x,
        countryCode: association.countryCode,
        federation: association.federation,
        ...(groupByTeam.has(team.externalId)
          ? { groupName: groupByTeam.get(team.externalId) }
          : {}),
        providerMetadata: {
          officialName: team.officialName,
          legacyId: team.legacyId,
          tournamentCalendarId: calendarId,
          associationSource: MANUAL_PDF_URL,
          ...(thirdPlacedIds.has(team.externalId)
            ? {
                exitRoute: 'SUDAMERICANA_PLAYOFFS',
                exportedToCompetition: 'conmebol-sudamericana',
                groupPosition: 3,
              }
            : groupByTeam.has(team.externalId)
              ? { entryRoute: 'LIBERTADORES_GROUP_STAGE' }
              : { entryRoute: 'LIBERTADORES_PRELIMINARY' }),
        },
      };
    })
    .sort((left, right) => left.externalId.localeCompare(right.externalId));

  const groupMatches = concreteMatches.filter(
    (match) => match.matchInfo.stage.name === 'Fase de grupos',
  );
  const roundOf16Matches = concreteMatches.filter(
    (match) => match.matchInfo.stage.name === '8th Finals',
  );
  const structure: JsonRecord[] = [
    {
      kind: 'STAGE',
      externalId: 'stage:preliminary',
      slug: 'fases-preliminares',
      name: 'Fases preliminares',
      type: 'KNOCKOUT',
      order: 1,
      metadata: { historical: true, format: 'TWO_LEGS', phases: 3 },
    },
    {
      kind: 'STAGE',
      externalId: 'stage:groups',
      slug: 'fase-de-grupos',
      name: 'Fase de grupos',
      type: 'GROUP',
      order: 2,
      metadata: { groups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
    },
    {
      kind: 'STAGE',
      externalId: 'stage:finals',
      slug: 'fase-final',
      name: 'Fase final',
      type: 'KNOCKOUT',
      order: 3,
      metadata: { twoLegsThroughSemifinal: true, finalSingleMatch: true },
    },
  ];
  for (const round of preliminaryRounds) {
    const roundMatches = concreteMatches.filter(
      (match) => match.matchInfo.stage.name === round.stageName,
    );
    structure.push({
      kind: 'ROUND',
      externalId: round.externalId,
      stageExternalId: 'stage:preliminary',
      name: round.name,
      order: round.order,
      status: officialRoundStatus(roundMatches),
      ...officialWindow(roundMatches),
      metadata: { historical: true, format: 'TWO_LEGS' },
    });
  }
  for (let round = 1; round <= 6; round += 1) {
    const entries = groupMatches.filter(
      (match) => groupRound(new Date(match.matchInfo.date * 1000).toISOString()) === round,
    );
    structure.push({
      kind: 'ROUND',
      externalId: `round:group-${round}`,
      stageExternalId: 'stage:groups',
      name: `Rodada ${round}`,
      order: round,
      status: officialRoundStatus(entries),
      ...officialWindow(entries),
      metadata: { groups: 8, matches: 16 },
    });
  }
  structure.push(
    {
      kind: 'ROUND',
      externalId: 'round:round-of-16',
      stageExternalId: 'stage:finals',
      name: 'Oitavas de final',
      order: 1,
      status: officialRoundStatus(roundOf16Matches),
      ...officialWindow(roundOf16Matches),
      metadata: {
        format: 'TWO_LEGS',
        officialPairings: roundOf16Pairings,
        officialDrawSource: ROUND_OF_16_URL,
      },
    },
    {
      kind: 'ROUND',
      externalId: 'round:quarterfinals',
      stageExternalId: 'stage:finals',
      name: 'Quartas de final',
      order: 2,
      status: 'SCHEDULED',
      startsAt: '2026-09-08T12:00:00.000Z',
      endsAt: '2026-09-18T02:30:00.000Z',
      metadata: {
        format: 'TWO_LEGS',
        participants: 'WINNERS_OF_ROUND_OF_16',
        officialWindow: ['2026-09-08', '2026-09-17'],
        concreteTiesDeferred: true,
      },
    },
    {
      kind: 'ROUND',
      externalId: 'round:semifinals',
      stageExternalId: 'stage:finals',
      name: 'Semifinais',
      order: 3,
      status: 'SCHEDULED',
      startsAt: '2026-10-13T12:00:00.000Z',
      endsAt: '2026-10-22T02:30:00.000Z',
      metadata: {
        format: 'TWO_LEGS',
        participants: 'WINNERS_OF_QUARTERFINALS',
        officialWindow: ['2026-10-13', '2026-10-21'],
        concreteTiesDeferred: true,
      },
    },
    {
      kind: 'ROUND',
      externalId: 'round:final',
      stageExternalId: 'stage:finals',
      name: 'Final',
      order: 4,
      status: 'SCHEDULED',
      startsAt: '2026-11-28T12:00:00.000Z',
      endsAt: '2026-11-29T02:59:59.000Z',
      metadata: {
        format: 'SINGLE_MATCH',
        participants: 'WINNERS_OF_SEMIFINALS',
        officialDate: '2026-11-28',
        city: 'Montevideo',
        countryCode: 'URY',
        venueStatus: 'TBC',
        concreteTieDeferred: true,
      },
    },
  );

  const tieByMatchId = new Map<string, { externalId: string; legNumber: 1 | 2 }>();
  const ties: JsonRecord[] = [];
  for (const round of preliminaryRounds) {
    const roundMatches = concreteMatches.filter(
      (match) => match.matchInfo.stage.name === round.stageName,
    );
    const grouped = groupTies(roundMatches).sort(([left], [right]) => left.localeCompare(right));
    grouped.forEach(([pairKey, legs], index) => {
      if (legs.length !== 2)
        throw new Error(`${round.name} tie ${pairKey} has no two official legs.`);
      const { home, away } = teamPair(legs[0]);
      const externalId = `tie:libertadores:${round.order}:${pairKey}`;
      ties.push({
        externalId,
        key: `preliminary-${round.order}-${String(index + 1).padStart(2, '0')}`,
        order: index + 1,
        stageExternalId: 'stage:preliminary',
        roundExternalId: round.externalId,
        teamAExternalId: home.externalId,
        teamBExternalId: away.externalId,
        teamAName: home.name,
        teamBName: away.name,
        expectedLegs: 2,
        status: 'DECIDED',
        ...decidedTie(legs),
        provenance: FIXTURES_URL,
        metadata: { historical: true, officialStage: round.stageName },
      });
      legs.forEach((leg, legIndex) =>
        tieByMatchId.set(leg.matchInfo.externalId, {
          externalId,
          legNumber: (legIndex + 1) as 1 | 2,
        }),
      );
    });
  }
  roundOf16Pairings.forEach((pairing, index) => {
    const legs = pairingMatches(roundOf16Matches, pairing).sort(
      (left, right) => left.matchInfo.date - right.matchInfo.date,
    );
    if (legs.length !== 2)
      throw new Error(`Round-of-16 pairing ${pairing.join(' x ')} is incomplete.`);
    const participants = new Map<string, JsonRecord>();
    for (const leg of legs) {
      for (const team of leg.matchInfo.contestant as JsonRecord[])
        participants.set(team.externalId, team);
    }
    const [teamA, teamB] = [...participants.values()];
    const externalId = `tie:libertadores:round-of-16:${[...participants.keys()].sort().join(':')}`;
    ties.push({
      externalId,
      key: `round-of-16-${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      stageExternalId: 'stage:finals',
      roundExternalId: 'round:round-of-16',
      teamAExternalId: teamA.externalId,
      teamBExternalId: teamB.externalId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      expectedLegs: 2,
      status: 'SCHEDULED',
      provenance: `${ROUND_OF_16_URL} | ${ROUND_OF_16_SCHEDULE_URL}`,
      metadata: { bracketPosition: index + 1, officialFixture: ROUND_OF_16_PDF_URL },
    });
    legs.forEach((leg, legIndex) =>
      tieByMatchId.set(leg.matchInfo.externalId, {
        externalId,
        legNumber: (legIndex + 1) as 1 | 2,
      }),
    );
  });

  const schedule = concreteMatches.map((match) => {
    const stageName = match.matchInfo.stage.name;
    const { home, away } = teamPair(match);
    const startsAt = new Date(match.matchInfo.date * 1000).toISOString();
    const preliminary = preliminaryRounds.find((round) => round.stageName === stageName);
    const tie = tieByMatchId.get(match.matchInfo.externalId);
    const venue = match.matchInfo.venue
      ? { name: match.matchInfo.venue.longName ?? match.matchInfo.venue.shortName }
      : undefined;
    return {
      externalId: match.matchInfo.externalId,
      homeTeamExternalId: home.externalId,
      awayTeamExternalId: away.externalId,
      homeTeamName: home.name,
      awayTeamName: away.name,
      startsAt,
      kickoffConfirmed: statusOf(match) === 'FINISHED' || !match.matchInfo.tbc,
      status: statusOf(match),
      stageExternalId: preliminary
        ? 'stage:preliminary'
        : stageName === 'Fase de grupos'
          ? 'stage:groups'
          : 'stage:finals',
      roundExternalId: preliminary
        ? preliminary.externalId
        : stageName === 'Fase de grupos'
          ? `round:group-${groupRound(startsAt)}`
          : 'round:round-of-16',
      ...(tie ? { tieExternalId: tie.externalId, legNumber: tie.legNumber } : {}),
      ...(groupByTeam.has(home.externalId) && stageName === 'Fase de grupos'
        ? { groupName: groupByTeam.get(home.externalId) }
        : {}),
      ...(venue ? { venue } : {}),
      providerMetadata: {
        legacyId: match.matchInfo.legacyId,
        officialPath: match.matchInfo.path,
        rawStage: stageName,
        officialStatus: match.liveData?.matchStatus,
        officialLastUpdated: match.matchInfo.externalLastUpdated,
      },
    };
  });
  const results = concreteMatches
    .filter((match) => statusOf(match) === 'FINISHED')
    .map((match) => {
      const { home, away } = teamPair(match);
      const fullTime = match.liveData.scoreEntries?.ft;
      const penalties = match.liveData.scoreEntries?.pen;
      return {
        externalId: `result:${match.matchInfo.externalId}`,
        matchExternalId: match.matchInfo.externalId,
        homeTeamExternalId: home.externalId,
        awayTeamExternalId: away.externalId,
        homeTeamName: home.name,
        awayTeamName: away.name,
        startsAt: new Date(match.matchInfo.date * 1000).toISOString(),
        homeScore: match.liveData.home_score,
        awayScore: match.liveData.away_score,
        ...(fullTime
          ? {
              regulationHomeScore: fullTime.home_score,
              regulationAwayScore: fullTime.away_score,
            }
          : {}),
        ...(penalties
          ? {
              penaltyHomeScore: penalties.home_score,
              penaltyAwayScore: penalties.away_score,
            }
          : {}),
        status: 'FINISHED' as const,
        providerMetadata: {
          officialStatus: match.liveData.matchStatus,
          scoreEntries: match.liveData.scoreEntries,
          matchWinner: match.liveData.match_winner,
        },
      };
    });
  const standings = divisions.flatMap((division) => {
    const groupName = String(division.groupName).replace(/^Grupo\s+/i, '');
    return (division.ranking as JsonRecord[]).map((row) => ({
      externalId: `standing:${groupName}:${row.contestantId}`,
      teamExternalId: row.contestantId,
      teamName: teamRecords.get(row.contestantId)?.name ?? row.contestantClubName,
      groupName,
      position: row.rank,
      played: row.matchesPlayed,
      won: row.matchesWon,
      drawn: row.matchesDrawn,
      lost: row.matchesLost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      points: row.points,
      qualification: row.rank <= 2 ? 'QUALIFIED' : row.rank === 3 ? 'TRANSFERRED' : 'ELIMINATED',
      providerMetadata: {
        rankStatus: row.rankStatus,
        lastSix: row.lastSix,
        ...(row.rank === 3
          ? {
              targetCompetition: 'conmebol-sudamericana',
              targetRound: 'playoffs',
            }
          : {}),
      },
    }));
  });

  const rawSnapshot = {
    schemaVersion: 2 as const,
    provider: 'conmebol-official',
    competition: 'conmebol-libertadores',
    season: '2026',
    source: MANUAL_PAGE_URL,
    collectedAt: localCollectedAt(),
    collectionTimezone: 'America/Sao_Paulo',
    sourceOffset: '-03:00',
    metadata: {
      tournamentId: 15,
      tournamentCalendarId: calendarId,
      officialFixtureCount: matches.length,
      scoreableFrom: '2026-08-11T22:00:00.000Z',
      scoreableCutoffBasis:
        'First fully confirmed Round-of-16 kickoff: Fluminense vs Independiente Rivadavia at Maracanã.',
      exportedSudamericanaTeamIds: [...thirdPlacedIds].sort(),
      officialStandingsPage: TABLE_URL,
      officialStandingsFeed: standingsUrl,
      deferredConcreteTies: {
        quarterfinals: 4,
        semifinals: 2,
        final: 1,
        reason:
          'Participants depend on future winners; official bracket slots are stored on rounds.',
      },
    },
    artifacts,
    data: { teams, structure, ties, schedule, results, standings },
  };
  const snapshot = {
    ...rawSnapshot,
    snapshotChecksum: computeOfficialSnapshotChecksum(rawSnapshot as never),
  };
  parseOfficialSourceSnapshot(snapshot, {
    provider: 'conmebol-official',
    competition: 'conmebol-libertadores',
  });
  if (
    teams.length !== 47 ||
    structure.length !== 16 ||
    ties.length !== 23 ||
    schedule.length !== 142 ||
    results.length !== 126 ||
    standings.length !== 32 ||
    thirdPlacedIds.size !== 8
  ) {
    throw new Error(
      `Incomplete official cardinality: ${teams.length} teams, ${structure.length} structure, ${ties.length} ties, ${schedule.length} matches, ${results.length} results, ${standings.length} standings, ${thirdPlacedIds.size} transfers.`,
    );
  }
  return snapshot;
}

async function main() {
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
  const output = outputArgument
    ? resolve(outputArgument.slice('--output='.length))
    : DEFAULT_OUTPUT;
  const snapshot = await collectLibertadores2026Snapshot();
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        output,
        collectedAt: snapshot.collectedAt,
        checksum: snapshot.snapshotChecksum,
        artifacts: snapshot.artifacts.map(({ source, checksum, byteLength }) => ({
          source,
          checksum,
          byteLength,
        })),
        counts: {
          teams: snapshot.data.teams.length,
          structure: snapshot.data.structure.length,
          ties: snapshot.data.ties.length,
          schedule: snapshot.data.schedule.length,
          results: snapshot.data.results.length,
          standings: snapshot.data.standings.length,
          sudamericanaTransfers: snapshot.metadata.exportedSudamericanaTeamIds.length,
        },
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
