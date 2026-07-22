import { createHash } from 'node:crypto';
import {
  fetchBytesWithPolicy,
  fetchTextWithPolicy,
  sharedProviderResponseCache,
  type FetchTextPolicy,
} from '../../../http/fetch-policy.js';
import {
  computeOfficialSnapshotChecksum,
  loadSanitizedOfficialFixture,
  parseOfficialSourceSnapshot,
  snapshotEvidence,
  type OfficialSourceSnapshot,
} from '../official-source-snapshot.js';
import {
  normalizedMatchArraySchema,
  normalizedResultArraySchema,
  normalizedStandingArraySchema,
  normalizedStructureArraySchema,
  normalizedTeamArraySchema,
  normalizedTieArraySchema,
  type CompetitionDataProvider,
  type NormalizedMatch,
  type NormalizedResult,
  type NormalizedStructureEntity,
  type NormalizedTeam,
  type NormalizedTie,
  type ProviderContext,
  type ProviderHealth,
} from '../competition-data-provider.js';
import { checksum } from '../provider-utils.js';

export const CBF_COPA_DO_BRASIL_2026_COMPETITION = 'copa-do-brasil';
export const CBF_COPA_DO_BRASIL_2026_SEASON = '2026';
export const CBF_COPA_DO_BRASIL_2026_TABLE_URL =
  'https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/2026';
export const CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_URL = (phasePageId: string) =>
  `${CBF_COPA_DO_BRASIL_2026_TABLE_URL}/${phasePageId}?documento=Tabela%20Detalhada`;
export const CBF_COPA_DO_BRASIL_2026_REC_URL =
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Copa_do_Brasil_2026_66989a5426.pdf';
export const CBF_COPA_DO_BRASIL_2026_PGA_URL =
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/PGA_Copa_do_Brasil_2026_b8ea9aaeb8.pdf';
export const CBF_COPA_DO_BRASIL_2026_BASIC_TABLE_URL =
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_Basica_Copa_do_Brasil_2026_77efe8f233.pdf';
export const CBF_COPA_DO_BRASIL_2026_DETAILED_TABLE_URL =
  'https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_Detalhada_6_Fase_Copa_Betano_do_Brasil_2026_1_ecf9a829ca.pdf';

export const CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_IDS = {
  1: '1995',
  2: '1996',
  3: '1997',
  4: '1998',
  5: '1999',
  6: '2000',
} as const;

const PHASE_EXPECTED_LEGS = [1, 1, 1, 1, 2, 2, 2, 2, 1] as const;
const PHASE_NAMES = [
  '1ª Fase',
  '2ª Fase',
  '3ª Fase',
  '4ª Fase',
  '5ª Fase',
  'Oitavas de Final',
  'Quartas de Final',
  'Semifinal',
  'Final',
] as const;

const CBF_POLICY: FetchTextPolicy = {
  timeoutMs: 15_000,
  maxBytes: 4 * 1024 * 1024,
  retries: 2,
  cache: sharedProviderResponseCache,
  cacheTtlMs: 60_000,
};

export interface CbfCopaDoBrasilDocumentEvidence {
  kind: 'REC' | 'PGA' | 'BASIC_TABLE' | 'DETAILED_TABLE';
  url: string;
  checksum: string;
  bytes: number;
  collectedAt: string;
}

export interface CbfCopaDoBrasilCollectionEvidence {
  source: string;
  collectedAt: string;
  timezone: 'America/Sao_Paulo';
  sourceOffset: '-03:00';
  checksum: string;
  pagesFetched: number;
  rawMatches: number;
  scheduledMatches: number;
  finishedResults: number;
  teams: number;
  ties: number;
  penalties: number;
  documents: CbfCopaDoBrasilDocumentEvidence[];
}

interface ParsedGame {
  phase: number;
  group: number;
  gameNumber: number;
  home: { externalId: string; cbfId: string; name: string };
  away: { externalId: string; cbfId: string; name: string };
  startsAt: string;
  date: string;
  time: string;
  location: string;
  venue: string;
  homeScore: number | null;
  awayScore: number | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
}

export interface CbfCopaDoBrasilSnapshotCollection {
  snapshot: OfficialSourceSnapshot;
  evidence: CbfCopaDoBrasilCollectionEvidence;
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function decodeHtml(value: string) {
  return value
    .replaceAll(/<!--[\s\S]*?-->/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .trim();
}

function stripHtml(value: string) {
  return decodeHtml(value.replaceAll(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' '));
}

function matchingDiv(payload: string, start: number, opening: string) {
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start + opening.length;
  let depth = 1;
  for (;;) {
    const match = tags.exec(payload);
    if (!match) throw new Error('CBF Copa table contains an unbalanced game card.');
    if (match[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return payload.slice(start, match.index + match[0].length);
  }
}

function gameCards(payload: string) {
  const cards: Array<{ html: string; start: number }> = [];
  const openings = /<div\b[^>]*class="[^"]*gameCardContainer[^"]*"[^>]*>/gi;
  for (;;) {
    const match = openings.exec(payload);
    if (!match) break;
    cards.push({ html: matchingDiv(payload, match.index, match[0]), start: match.index });
  }
  if (cards.length === 0) throw new Error('CBF Copa table has no official game cards.');
  return cards;
}

function localStartsAt(date: string, time: string) {
  const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match || !/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(`CBF Copa kickoff is invalid: ${date} ${time}`);
  }
  const [, day, month, year] = match;
  const parsed = new Date(`${year}-${month}-${day}T${time}:00-03:00`);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`CBF Copa kickoff is invalid: ${date} ${time}`);
  return parsed.toISOString();
}

function teamFromCard(card: string, index: 0 | 1) {
  const teams = [
    ...card.matchAll(
      /href="\/futebol-brasileiro\/times\/copa-do-brasil\/masculino\/2026\/(\d+)"[\s\S]*?<strong[^>]*title="([^"]+)"/gi,
    ),
  ];
  const team = teams[index];
  if (!team) throw new Error('CBF Copa card does not contain two official clubs.');
  const cbfId = team[1];
  return {
    cbfId,
    name: decodeHtml(team[2]),
    externalId: `team:cbf-copa-do-brasil:2026:${cbfId}`,
  };
}

function parseGame(
  payload: string,
  phase: number,
  card: { html: string; start: number },
): ParsedGame {
  const cardText = stripHtml(card.html);
  const numberMatch = cardText.match(/Jogo\s*(\d+)/i);
  const dateTimeMatch = cardText.match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}:\d{2})/);
  const scoreValues = [...card.html.matchAll(/class="[^"]*styles_gol[^"]*"[^>]*>([^<]*)</gi)].map(
    (match) => match[1].trim(),
  );
  const penaltyValues = [
    ...card.html.matchAll(/class="[^"]*styles_penaltis[^"]*"[^>]*>\((\d+)\)</gi),
  ].map((match) => Number(match[1]));
  if (!numberMatch || !dateTimeMatch || scoreValues.length !== 2) {
    throw new Error(`CBF Copa game card is incomplete: ${cardText.slice(0, 180)}`);
  }
  const gameNumber = Number(numberMatch[1]);
  const before = payload.slice(Math.max(0, card.start - 1200), card.start);
  const groupMatches = [...before.matchAll(/>GRUPO\s*(\d+)</gi)];
  const group = Number(groupMatches.at(-1)?.[1]);
  if (!Number.isInteger(group))
    throw new Error(`CBF Copa game ${gameNumber} has no official group.`);
  const pHtml = card.html.match(/<p>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  const segments = pHtml
    .split(/<br\s*\/?\s*>/i)
    .map(stripHtml)
    .filter(Boolean);
  const location = segments[1] ?? '';
  const venue = segments[2] ?? '';
  const home = teamFromCard(card.html, 0);
  const away = teamFromCard(card.html, 1);
  const [date, time] = [dateTimeMatch[1], dateTimeMatch[2]];
  const scores = scoreValues.map((value) => (value === '' ? null : Number(value)));
  return {
    phase,
    group,
    gameNumber,
    home,
    away,
    startsAt: localStartsAt(date, time),
    date,
    time,
    location,
    venue,
    homeScore: scores[0],
    awayScore: scores[1],
    homePenaltyScore: penaltyValues[0] ?? null,
    awayPenaltyScore: penaltyValues[1] ?? null,
  };
}

export function parseCbfCopaDoBrasil2026Table(payload: string, phase: number) {
  return gameCards(payload).map((card) => parseGame(payload, phase, card));
}

function phaseForGroup(group: number) {
  if (group <= 14) return 1;
  if (group <= 58) return 2;
  if (group <= 82) return 3;
  if (group <= 94) return 4;
  if (group <= 110) return 5;
  return 6;
}

function entryMetadata(teams: ParsedGame[]) {
  const firstPhase = new Map<string, number>();
  for (const game of teams) {
    for (const team of [game.home, game.away]) {
      firstPhase.set(team.externalId, Math.min(firstPhase.get(team.externalId) ?? 99, game.phase));
    }
  }
  return firstPhase;
}

function tieWinner(games: ParsedGame[], teamA: string, teamB: string) {
  const aggregate = new Map([
    [teamA, 0],
    [teamB, 0],
  ]);
  for (const game of games) {
    if (game.homeScore === null || game.awayScore === null) return null;
    aggregate.set(
      teamA,
      aggregate.get(teamA)! + (game.home.externalId === teamA ? game.homeScore : game.awayScore),
    );
    aggregate.set(
      teamB,
      aggregate.get(teamB)! + (game.home.externalId === teamB ? game.homeScore : game.awayScore),
    );
  }
  if (aggregate.get(teamA) !== aggregate.get(teamB)) {
    return {
      winnerTeamExternalId: aggregate.get(teamA)! > aggregate.get(teamB)! ? teamA : teamB,
      decisionMethod: 'AGGREGATE' as const,
      aggregateTeamAScore: aggregate.get(teamA)!,
      aggregateTeamBScore: aggregate.get(teamB)!,
    };
  }
  const last = games.at(-1)!;
  if (last.homePenaltyScore === null || last.awayPenaltyScore === null) {
    throw new Error(`CBF Copa tie ${last.group} is tied without official penalties.`);
  }
  const winner =
    last.homePenaltyScore > last.awayPenaltyScore ? last.home.externalId : last.away.externalId;
  return {
    winnerTeamExternalId: winner,
    decisionMethod: 'PENALTIES' as const,
    aggregateTeamAScore: aggregate.get(teamA)!,
    aggregateTeamBScore: aggregate.get(teamB)!,
  };
}

function buildSnapshot(games: ParsedGame[]) {
  const orderedGames = [...games].sort((left, right) => left.gameNumber - right.gameNumber);
  const groups = new Map<number, ParsedGame[]>();
  for (const game of orderedGames)
    groups.set(game.group, [...(groups.get(game.group) ?? []), game]);
  const firstPhase = entryMetadata(orderedGames);
  const teamMap = new Map<string, NormalizedTeam>();
  for (const game of orderedGames) {
    for (const team of [game.home, game.away]) {
      const entryPhase = firstPhase.get(team.externalId)!;
      const entryRoute =
        entryPhase === 5
          ? 'CRITERION_1_BRASILEIRO_SERIE_A'
          : entryPhase === 3
            ? 'CRITERION_2_COPA_REGIONAL_OU_SERIE_C_D'
            : 'CRITERION_3_ESTADUAL';
      teamMap.set(team.externalId, {
        externalId: team.externalId,
        name: team.name,
        type: 'CLUB',
        countryCode: 'BRA',
        federation: 'CBF',
        providerMetadata: {
          cbfTeamId: team.cbfId,
          identityMode: 'CBF_EXTERNAL_ID',
          entryPhase,
          entryRoute,
          officialCompetition: 'Copa do Brasil 2026',
        },
      });
    }
  }
  const structure: NormalizedStructureEntity[] = [
    {
      kind: 'STAGE',
      externalId: 'stage:knockout',
      slug: 'mata-mata',
      name: 'Fases eliminatórias',
      type: 'KNOCKOUT',
      order: 1,
      metadata: {
        officialSource: CBF_COPA_DO_BRASIL_2026_REC_URL,
        phases: 9,
        standingsSupported: false,
        navigation: 'BRACKET_AND_PHASE_LIST',
      },
    },
  ];
  for (let phase = 1; phase <= 9; phase += 1) {
    const phaseGames = orderedGames.filter((game) => game.phase === phase);
    const phaseGroups = [...new Set(phaseGames.map((game) => game.group))];
    const starts = phaseGames.map((game) => new Date(game.startsAt).getTime());
    structure.push({
      kind: 'ROUND',
      externalId: `round:phase-${phase}`,
      stageExternalId: 'stage:knockout',
      name: PHASE_NAMES[phase - 1],
      order: phase,
      status:
        phaseGames.length > 0 && phaseGames.every((game) => game.homeScore !== null)
          ? 'FINISHED'
          : phaseGames.some((game) => game.homeScore !== null)
            ? 'ACTIVE'
            : 'SCHEDULED',
      ...(starts.length > 0
        ? {
            startsAt: new Date(Math.min(...starts)).toISOString(),
            endsAt: new Date(Math.max(...starts)).toISOString(),
          }
        : {}),
      metadata: {
        phase,
        expectedLegs: PHASE_EXPECTED_LEGS[phase - 1],
        groups: phaseGroups.length || (phase === 7 ? 4 : phase === 8 ? 2 : 1),
        scheduledMatches: phaseGames.length,
        historicalResults: phaseGames.filter((game) => game.homeScore !== null).length,
        deferredTieSlots: phase >= 7 ? (phase === 7 ? 4 : phase === 8 ? 2 : 1) : 0,
        mandoRule:
          phase === 9
            ? 'CBF defines the final venue and home designation.'
            : phase <= 4
              ? 'Official table/sortition designation.'
              : 'Official table/sortition designation; return leg reverses the home team.',
        tieBreak: phase <= 4 || phase === 9 ? 'PENALTIES' : 'AGGREGATE_THEN_PENALTIES',
      },
    });
  }
  const ties: NormalizedTie[] = [];
  for (const [group, groupGames] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    const phase = phaseForGroup(group);
    const teamA = groupGames[0].home;
    const teamB = groupGames[0].away;
    const decision = tieWinner(groupGames, teamA.externalId, teamB.externalId);
    ties.push({
      externalId: `tie:cbf-copa-do-brasil:2026:${group}`,
      key: `phase-${phase}-group-${group}`,
      order: group,
      stageExternalId: 'stage:knockout',
      roundExternalId: `round:phase-${phase}`,
      teamAExternalId: teamA.externalId,
      teamBExternalId: teamB.externalId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      expectedLegs: PHASE_EXPECTED_LEGS[phase - 1],
      status: decision ? 'DECIDED' : 'SCHEDULED',
      ...(decision ?? {}),
      provenance: 'CBF official detailed table and current results',
      metadata: {
        officialGroup: group,
        phase,
        sourceGameNumbers: groupGames.map((game) => game.gameNumber),
        legs: groupGames.map((game, index) => ({
          legNumber: index + 1,
          homeTeamExternalId: game.home.externalId,
          awayTeamExternalId: game.away.externalId,
          startsAt: game.startsAt,
          venue: game.venue,
          location: game.location,
        })),
      },
    });
  }
  const schedule: NormalizedMatch[] = orderedGames.map((game) => {
    const groupGames = groups.get(game.group)!;
    const legNumber =
      groupGames.findIndex((candidate) => candidate.gameNumber === game.gameNumber) + 1;
    const phase = game.phase;
    const externalId = `match:cbf-copa-do-brasil:2026:${game.gameNumber}`;
    return {
      externalId,
      homeTeamExternalId: game.home.externalId,
      awayTeamExternalId: game.away.externalId,
      homeTeamName: game.home.name,
      awayTeamName: game.away.name,
      startsAt: game.startsAt,
      kickoffConfirmed: true,
      status: game.homeScore === null ? 'SCHEDULED' : 'FINISHED',
      stageExternalId: 'stage:knockout',
      roundExternalId: `round:phase-${phase}`,
      tieExternalId: `tie:cbf-copa-do-brasil:2026:${game.group}`,
      legNumber: legNumber as 1 | 2,
      venue: game.venue
        ? { name: game.venue, city: game.location || undefined, countryCode: 'BRA' }
        : undefined,
      providerMetadata: {
        cbfGameNumber: game.gameNumber,
        officialGroup: game.group,
        phase,
        location: game.location,
        sourceTable: CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_URL(
          CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_IDS[phase as 1 | 2 | 3 | 4 | 5 | 6],
        ),
      },
    };
  });
  const results: NormalizedResult[] = orderedGames
    .filter((game) => game.homeScore !== null && game.awayScore !== null)
    .map((game) => ({
      externalId: `result:cbf-copa-do-brasil:2026:${game.gameNumber}`,
      matchExternalId: `match:cbf-copa-do-brasil:2026:${game.gameNumber}`,
      homeTeamExternalId: game.home.externalId,
      awayTeamExternalId: game.away.externalId,
      homeTeamName: game.home.name,
      awayTeamName: game.away.name,
      startsAt: game.startsAt,
      homeScore: game.homeScore!,
      awayScore: game.awayScore!,
      regulationHomeScore: game.homeScore!,
      regulationAwayScore: game.awayScore!,
      ...(game.homePenaltyScore !== null
        ? { penaltyHomeScore: game.homePenaltyScore, penaltyAwayScore: game.awayPenaltyScore! }
        : {}),
      status: 'FINISHED',
      providerMetadata: {
        cbfGameNumber: game.gameNumber,
        officialGroup: game.group,
        phase: game.phase,
        sourceTable: CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_URL(
          CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_IDS[game.phase as 1 | 2 | 3 | 4 | 5 | 6],
        ),
      },
    }));
  const data = {
    teams: normalizedTeamArraySchema.parse(
      [...teamMap.values()].sort((left, right) => left.externalId.localeCompare(right.externalId)),
    ),
    structure: normalizedStructureArraySchema.parse(structure),
    ties: normalizedTieArraySchema.parse(ties),
    schedule: normalizedMatchArraySchema.parse(schedule),
    results: normalizedResultArraySchema.parse(results),
    standings: normalizedStandingArraySchema.parse([]),
  };
  return { data, games: orderedGames };
}

async function fetchDocument(
  kind: CbfCopaDoBrasilDocumentEvidence['kind'],
  url: string,
  collectedAt: string,
  policy: FetchTextPolicy,
) {
  const bytes = await fetchBytesWithPolicy(
    url,
    { headers: { accept: 'application/pdf', 'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0' } },
    { ...policy, maxBytes: Math.max(policy.maxBytes, 8 * 1024 * 1024) },
  );
  return { kind, url, checksum: sha256(bytes), bytes: bytes.byteLength, collectedAt };
}

export async function collectCopaDoBrasil2026Snapshot(
  policy: FetchTextPolicy = CBF_POLICY,
): Promise<CbfCopaDoBrasilSnapshotCollection> {
  const collectedAt = new Date().toISOString();
  const pages = await Promise.all(
    Object.entries(CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_IDS).map(async ([phase, pageId]) => ({
      phase: Number(phase),
      source: CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_URL(pageId),
      payload: await fetchTextWithPolicy(
        CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_URL(pageId),
        { headers: { accept: 'text/html', 'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0' } },
        policy,
      ),
    })),
  );
  const documents = await Promise.all([
    fetchDocument('REC', CBF_COPA_DO_BRASIL_2026_REC_URL, collectedAt, policy),
    fetchDocument('PGA', CBF_COPA_DO_BRASIL_2026_PGA_URL, collectedAt, policy),
    fetchDocument('BASIC_TABLE', CBF_COPA_DO_BRASIL_2026_BASIC_TABLE_URL, collectedAt, policy),
    fetchDocument(
      'DETAILED_TABLE',
      CBF_COPA_DO_BRASIL_2026_DETAILED_TABLE_URL,
      collectedAt,
      policy,
    ),
  ]);
  const games = pages.flatMap((page) => parseCbfCopaDoBrasil2026Table(page.payload, page.phase));
  const artifacts: OfficialSourceSnapshot['artifacts'] = [
    ...pages.map((page) => ({
      kind: 'PAGE' as const,
      source: page.source,
      contentType: 'text/html',
      retention: 'CHECKSUM_ONLY' as const,
      checksum: sha256(Buffer.from(page.payload, 'utf8')),
      byteLength: Buffer.byteLength(page.payload, 'utf8'),
    })),
    ...documents.map((document) => ({
      kind: 'PDF' as const,
      source: document.url,
      contentType: 'application/pdf',
      retention: 'CHECKSUM_ONLY' as const,
      checksum: document.checksum,
      byteLength: document.bytes,
    })),
  ];
  const { data } = buildSnapshot(games);
  const evidence: CbfCopaDoBrasilCollectionEvidence = {
    source: CBF_COPA_DO_BRASIL_2026_TABLE_URL,
    collectedAt,
    timezone: 'America/Sao_Paulo',
    sourceOffset: '-03:00',
    checksum: checksum({ data, documents }),
    pagesFetched: pages.length,
    rawMatches: games.length,
    scheduledMatches: data.schedule.length,
    finishedResults: data.results.length,
    teams: data.teams.length,
    ties: data.ties.length,
    penalties: data.results.filter((result) => result.penaltyHomeScore !== undefined).length,
    documents,
  };
  const content = {
    schemaVersion: 2 as const,
    provider: 'cbf-copa-do-brasil-official',
    competition: CBF_COPA_DO_BRASIL_2026_COMPETITION,
    season: CBF_COPA_DO_BRASIL_2026_SEASON,
    source: CBF_COPA_DO_BRASIL_2026_TABLE_URL,
    collectedAt,
    collectionTimezone: 'America/Sao_Paulo',
    sourceOffset: '-03:00',
    metadata: {
      format: 'KNOCKOUT',
      phases: 9,
      evidence,
      officialDocuments: documents,
      pages: pages.map((page) => page.source),
      historicalMatchesScoreable: false,
      scoreableFrom: '2026-08-01T20:30:00.000Z',
    },
    artifacts,
    data,
  };
  const snapshot = {
    ...content,
    snapshotChecksum: computeOfficialSnapshotChecksum(content),
  } satisfies OfficialSourceSnapshot;
  return { snapshot, evidence };
}

export interface CbfCopaDoBrasilProviderOptions {
  fixtureName?: string;
  snapshot?: unknown;
  fetchPolicy?: FetchTextPolicy;
}

export class CbfCopaDoBrasilProvider implements CompetitionDataProvider {
  readonly name = 'cbf-copa-do-brasil-official';
  readonly source: string;
  private readonly fixture?: OfficialSourceSnapshot;
  private readonly fetchPolicy: FetchTextPolicy;
  private collected?: Promise<CbfCopaDoBrasilSnapshotCollection>;

  constructor(options: CbfCopaDoBrasilProviderOptions = {}) {
    if (options.fixtureName && options.snapshot) {
      throw new Error('Provide exactly one Copa fixture or snapshot.');
    }
    this.fixture = options.fixtureName
      ? loadSanitizedOfficialFixture(options.fixtureName, {
          provider: this.name,
          competition: CBF_COPA_DO_BRASIL_2026_COMPETITION,
        })
      : options.snapshot
        ? parseOfficialSourceSnapshot(options.snapshot, {
            provider: this.name,
            competition: CBF_COPA_DO_BRASIL_2026_COMPETITION,
          })
        : undefined;
    this.fetchPolicy = options.fetchPolicy ?? CBF_POLICY;
    this.source = this.fixture?.source ?? CBF_COPA_DO_BRASIL_2026_TABLE_URL;
  }

  private collect() {
    this.collected ??= collectCopaDoBrasil2026Snapshot(this.fetchPolicy);
    return this.collected;
  }

  private async data() {
    return this.fixture?.data ?? (await this.collect()).snapshot.data;
  }

  async syncTeams(_context: ProviderContext) {
    return (await this.data()).teams;
  }

  async syncStructure(_context: ProviderContext) {
    return (await this.data()).structure;
  }

  async syncTies(_context: ProviderContext) {
    return (await this.data()).ties;
  }

  async syncSchedule(_context: ProviderContext) {
    return (await this.data()).schedule;
  }

  async syncResults(_context: ProviderContext) {
    return (await this.data()).results;
  }

  async syncStandings(_context: ProviderContext) {
    return (await this.data()).standings;
  }

  async snapshotEvidence() {
    return this.fixture
      ? snapshotEvidence(this.fixture)
      : snapshotEvidence((await this.collect()).snapshot);
  }

  async evidence() {
    return this.fixture ? snapshotEvidence(this.fixture) : (await this.collect()).evidence;
  }

  async healthCheck(_context: ProviderContext): Promise<ProviderHealth> {
    if (this.fixture) {
      return {
        ok: true,
        checkedAt: new Date().toISOString(),
        message: `immutable snapshot ${this.fixture.snapshotChecksum}`,
      };
    }
    try {
      const payload = await fetchTextWithPolicy(
        CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_URL(CBF_COPA_DO_BRASIL_2026_PHASE_PAGE_IDS[6]),
        { headers: { accept: 'text/html', 'user-agent': 'BolaoCopa2026-CBF-Reconciler/1.0' } },
        this.fetchPolicy,
      );
      const count = gameCards(payload).length;
      return count === 16
        ? {
            ok: true,
            checkedAt: new Date().toISOString(),
            message: 'CBF Copa phase 6 table reachable.',
          }
        : {
            ok: false,
            checkedAt: new Date().toISOString(),
            message: 'CBF Copa phase 6 table is incomplete.',
          };
    } catch (error) {
      return {
        ok: false,
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.name : 'provider error',
      };
    }
  }
}

export function copaDoBrasilItemChecksum(value: unknown) {
  return checksum(value);
}
