import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchBytesWithPolicy } from '../http/fetch-policy.js';
import {
  computeOfficialSnapshotChecksum,
  parseOfficialSourceSnapshot,
} from '../modules/providers/official-source-snapshot.js';
import { normalizeEntityName } from '../modules/providers/competition-data-provider.js';

const FIXTURES_URL = 'https://gol.conmebol.com/sudamericana/es/api/v2/tournament-fixtures/104';
const TABLE_URL = 'https://gol.conmebol.com/sudamericana/es/tournament-table/104';
const MANUAL_PAGE_URL =
  'https://www.conmebol.com/documentos/manual-de-clubes-conmebol-sudamericana-2026/';
const MANUAL_PDF_URL =
  'https://cdn.conmebol.com/wp-content/uploads/2025/12/CS-2026-Manual-de-Clubes-ESP-Feb26.pdf';
const GROUP_SCHEDULE_URL =
  'https://gol.conmebol.com/sudamericana/es/news/calendario-conmebol-sudamericana-2026-dias-horarios-y-sedes-de-la-fase-de-grupos';
const PLAYOFF_PAIRINGS_URL =
  'https://gol.conmebol.com/sudamericana/es/news/definidos-los-cruces-de-playoffs-de-la-conmebol-sudamericana';
const PLAYOFF_SCHEDULE_URL =
  'https://gol.conmebol.com/sudamericana/es/news/para-tomar-nota-asi-se-jugaran-los-playoffs-de-octavos-de-final-de-la-conmebol-sudamericana';
const ROUND_OF_16_URL =
  'https://gol.conmebol.com/sudamericana/es/news/asi-se-jugaran-los-octavos-de-final-de-la-conmebol-sudamericana';
const FINAL_URL =
  'https://gol.conmebol.com/sudamericana/es/news/barranquilla-sede-de-la-final-de-la-conmebol-sudamericana-2026';

const DEFAULT_OUTPUT = resolve(
  'src/modules/providers/__fixtures__/official/conmebol-sudamericana-2026.sanitized.json',
);

type JsonRecord = Record<string, any>;

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

function statusOf(match: JsonRecord) {
  const status = match.liveData?.matchStatus;
  if (status === 'Played') return 'FINISHED' as const;
  if (status === 'Playing' || match.liveData?.isLive) return 'LIVE' as const;
  if (status === 'Postponed') return 'POSTPONED' as const;
  if (status === 'Cancelled') return 'CANCELLED' as const;
  return 'SCHEDULED' as const;
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

const playoffDefinitions = [
  { key: 'playoff-a', teams: ['Boca Juniors', "O'Higgins"], roundOf16Opponent: 'Recoleta' },
  { key: 'playoff-b', teams: ['Bolívar', 'Grêmio'], roundOf16Opponent: 'São Paulo' },
  {
    key: 'playoff-c',
    teams: ['Independiente Santa Fe', 'Caracas'],
    roundOf16Opponent: 'River Plate',
  },
  {
    key: 'playoff-d',
    teams: ['Independiente Medellín', 'Vasco da Gama'],
    roundOf16Opponent: 'Olimpia',
  },
  {
    key: 'playoff-e',
    teams: ['Sporting Cristal', 'RB Bragantino'],
    roundOf16Opponent: 'Atlético Mineiro',
  },
  { key: 'playoff-f', teams: ['UCV', 'Santos'], roundOf16Opponent: 'Macará' },
  { key: 'playoff-g', teams: ['Nacional', 'Tigre'], roundOf16Opponent: 'Montevideo City Torque' },
  { key: 'playoff-h', teams: ['Lanús', 'Cienciano'], roundOf16Opponent: 'Botafogo' },
] as const;

function sameTeamName(left: string, right: string) {
  return normalizeEntityName(left) === normalizeEntityName(right);
}

function playoffDefinition(match: JsonRecord) {
  const names = teamPair(match);
  const actual = [names.home.name, names.away.name];
  const definition = playoffDefinitions.find((candidate) =>
    candidate.teams.every((expected) => actual.some((name) => sameTeamName(name, expected))),
  );
  if (!definition) throw new Error(`Unrecognized official playoff pairing: ${actual.join(' x ')}.`);
  return definition;
}

function roundWindow(matches: JsonRecord[], round: number) {
  const dates = matches
    .filter((match) => groupRound(new Date(match.matchInfo.date * 1000).toISOString()) === round)
    .map((match) => new Date(match.matchInfo.date * 1000).toISOString())
    .sort();
  return { startsAt: dates.at(0), endsAt: dates.at(-1) };
}

async function main() {
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
  const output = outputArgument
    ? resolve(outputArgument.slice('--output='.length))
    : DEFAULT_OUTPUT;
  const sourceSpecs = [
    [MANUAL_PAGE_URL, 'PAGE'],
    [MANUAL_PDF_URL, 'PDF'],
    [GROUP_SCHEDULE_URL, 'PAGE'],
    [FIXTURES_URL, 'RESPONSE'],
    [TABLE_URL, 'PAGE'],
    [PLAYOFF_PAIRINGS_URL, 'PAGE'],
    [PLAYOFF_SCHEDULE_URL, 'PAGE'],
    [ROUND_OF_16_URL, 'PAGE'],
    [FINAL_URL, 'PAGE'],
  ] as const;
  const fetched = await Promise.all(sourceSpecs.map(([url, kind]) => fetchArtifact(url, kind)));
  const fixturesBytes = fetched[sourceSpecs.findIndex(([url]) => url === FIXTURES_URL)].bytes;
  const tableBytes = fetched[sourceSpecs.findIndex(([url]) => url === TABLE_URL)].bytes;
  const fixturePayload = JSON.parse(Buffer.from(fixturesBytes).toString('utf8')) as JsonRecord;
  const matches = fixturePayload.match as JsonRecord[];
  const tableHtml = Buffer.from(tableBytes).toString('utf8');
  const outletKey = tableHtml.match(/outletAuthKey":"([a-z0-9]+)"/)?.[1];
  const calendarId = tableHtml.match(/field_cc_external_id":"(cup[a-z0-9]+)"/)?.[1];
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
  const standingByTeam = new Map<string, JsonRecord>();
  for (const division of divisions) {
    const groupName = String(division.groupName).replace(/^Grupo\s+/i, '');
    for (const row of division.ranking as JsonRecord[]) {
      groupByTeam.set(row.contestantId, groupName);
      standingByTeam.set(row.contestantId, row);
    }
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
  const groupTeamIds = new Set(groupByTeam.keys());
  const playoffMatches = concreteMatches.filter(
    (match) => match.matchInfo.stage.name === 'Knockout Round Play-offs',
  );
  const playoffTeamIds = new Set(
    playoffMatches.flatMap((match) =>
      (match.matchInfo.contestant as JsonRecord[]).map((team) => team.externalId),
    ),
  );
  const transferredTeamIds = new Set(
    [...playoffTeamIds].filter((teamId) => !groupTeamIds.has(teamId)),
  );

  const teams = [...teamRecords.values()]
    .map((team) => ({
      externalId: team.externalId,
      name: team.name,
      code: team.code,
      type: 'CLUB' as const,
      crestUrl: team.crest?.uri_1x,
      ...(groupByTeam.has(team.externalId) ? { groupName: groupByTeam.get(team.externalId) } : {}),
      providerMetadata: {
        officialName: team.officialName,
        legacyId: team.legacyId,
        tournamentCalendarId: calendarId,
        ...(transferredTeamIds.has(team.externalId)
          ? {
              entryRoute: 'LIBERTADORES_GROUP_THIRD',
              transferredFromCompetition: 'conmebol-libertadores',
            }
          : groupTeamIds.has(team.externalId)
            ? { entryRoute: 'SUDAMERICANA_GROUP_STAGE' }
            : { entryRoute: 'SUDAMERICANA_PRELIMINARY' }),
      },
    }))
    .sort((left, right) => left.externalId.localeCompare(right.externalId));

  const groupMatches = concreteMatches.filter(
    (match) => match.matchInfo.stage.name === 'Fase de grupos',
  );
  const structure: JsonRecord[] = [
    {
      kind: 'STAGE',
      externalId: 'stage:preliminary',
      slug: 'fase-preliminar',
      name: 'Fase preliminar',
      type: 'KNOCKOUT',
      order: 1,
      metadata: { historical: true, format: 'SINGLE_MATCH' },
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
    {
      kind: 'ROUND',
      externalId: 'round:preliminary',
      stageExternalId: 'stage:preliminary',
      name: 'Fase preliminar',
      order: 1,
      status: 'FINISHED',
      startsAt: '2026-03-03T22:00:00Z',
      endsAt: '2026-03-06T02:30:00Z',
      metadata: {
        historical: true,
        officialFormat: 'single match between clubs from same association',
      },
    },
    ...[1, 2, 3, 4, 5, 6].map((round) => ({
      kind: 'ROUND',
      externalId: `round:group-${round}`,
      stageExternalId: 'stage:groups',
      name: `Rodada ${round}`,
      order: round,
      status: 'FINISHED',
      ...roundWindow(groupMatches, round),
      metadata: { groups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
    })),
    {
      kind: 'ROUND',
      externalId: 'round:playoffs',
      stageExternalId: 'stage:finals',
      name: 'Playoffs das oitavas',
      order: 1,
      status: 'ACTIVE',
      startsAt: '2026-07-21T22:00:00Z',
      endsAt: '2026-07-31T00:30:00Z',
      metadata: {
        format: 'TWO_LEGS',
        entrants: '8 group runners-up + 8 Libertadores third-placed',
      },
    },
    {
      kind: 'ROUND',
      externalId: 'round:round-of-16',
      stageExternalId: 'stage:finals',
      name: 'Oitavas de final',
      order: 2,
      status: 'SCHEDULED',
      metadata: {
        format: 'TWO_LEGS',
        officialWindow: ['2026-08-12', '2026-08-19'],
        kickoffStatus: 'TBC',
        officialPairings: playoffDefinitions.map((pairing) => ({
          playoff: pairing.key.toUpperCase(),
          playoffTeams: pairing.teams,
          opponent: pairing.roundOf16Opponent,
        })),
      },
    },
    {
      kind: 'ROUND',
      externalId: 'round:quarterfinals',
      stageExternalId: 'stage:finals',
      name: 'Quartas de final',
      order: 3,
      status: 'SCHEDULED',
      metadata: {
        format: 'TWO_LEGS',
        officialWindow: ['2026-09-09', '2026-09-16'],
        officialBracket: ['A-H', 'B-G', 'C-F', 'D-E'],
        participants: 'TBC',
      },
    },
    {
      kind: 'ROUND',
      externalId: 'round:semifinals',
      stageExternalId: 'stage:finals',
      name: 'Semifinais',
      order: 4,
      status: 'SCHEDULED',
      metadata: {
        format: 'TWO_LEGS',
        officialWindow: ['2026-10-14', '2026-10-21'],
        officialBracket: ['S1-S4', 'S2-S3'],
        participants: 'TBC',
      },
    },
    {
      kind: 'ROUND',
      externalId: 'round:final',
      stageExternalId: 'stage:finals',
      name: 'Final',
      order: 5,
      status: 'SCHEDULED',
      metadata: {
        format: 'SINGLE_MATCH',
        officialDate: '2026-11-21',
        kickoffStatus: 'TBC',
        venue: 'Estadio Metropolitano Roberto Meléndez',
        city: 'Barranquilla',
        countryCode: 'COL',
      },
    },
  ];

  const preliminaryMatches = concreteMatches.filter(
    (match) => match.matchInfo.stage.name === '1st Round',
  );
  const ties: JsonRecord[] = preliminaryMatches.map((match, index) => {
    const { home, away } = teamPair(match);
    const winnerPosition = match.liveData?.match_winner;
    const winner = winnerPosition === 'home' ? home : winnerPosition === 'away' ? away : undefined;
    return {
      externalId: `tie:preliminary:${match.matchInfo.externalId}`,
      key: `preliminary-${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      stageExternalId: 'stage:preliminary',
      roundExternalId: 'round:preliminary',
      teamAExternalId: home.externalId,
      teamBExternalId: away.externalId,
      teamAName: home.name,
      teamBName: away.name,
      expectedLegs: 1,
      status: 'DECIDED',
      decisionMethod: match.liveData?.scoreEntries?.pen ? 'PENALTIES' : 'AGGREGATE',
      winnerTeamExternalId: winner?.externalId,
      provenance: FIXTURES_URL,
      metadata: { historical: true, officialMatchExternalId: match.matchInfo.externalId },
    };
  });
  for (const [index, definition] of playoffDefinitions.entries()) {
    const legs = playoffMatches
      .filter((match) => playoffDefinition(match).key === definition.key)
      .sort((left, right) => left.matchInfo.date - right.matchInfo.date);
    if (legs.length !== 2) throw new Error(`${definition.key} does not have two official legs.`);
    const participantByName = new Map<string, JsonRecord>();
    for (const match of legs) {
      for (const team of match.matchInfo.contestant as JsonRecord[]) {
        participantByName.set(normalizeEntityName(team.name), team);
      }
    }
    const teamA = participantByName.get(normalizeEntityName(definition.teams[0]));
    const teamB = participantByName.get(normalizeEntityName(definition.teams[1]));
    if (!teamA || !teamB) throw new Error(`Participants for ${definition.key} did not resolve.`);
    ties.push({
      externalId: `tie:${definition.key}`,
      key: definition.key,
      order: index + 1,
      stageExternalId: 'stage:finals',
      roundExternalId: 'round:playoffs',
      teamAExternalId: teamA.externalId,
      teamBExternalId: teamB.externalId,
      teamAName: teamA.name,
      teamBName: teamB.name,
      expectedLegs: 2,
      status: legs.every((match) => statusOf(match) === 'FINISHED') ? 'DECIDED' : 'IN_PROGRESS',
      ...(legs.every((match) => statusOf(match) === 'FINISHED')
        ? { decisionMethod: 'AGGREGATE' }
        : {}),
      provenance: `${PLAYOFF_PAIRINGS_URL} | ${PLAYOFF_SCHEDULE_URL}`,
      metadata: {
        transferRule: 'Sudamericana group runner-up vs Libertadores group third-placed',
        roundOf16Opponent: definition.roundOf16Opponent,
      },
    });
  }

  const schedule = concreteMatches.map((match) => {
    const stageName = match.matchInfo.stage.name;
    const { home, away } = teamPair(match);
    const startsAt = new Date(match.matchInfo.date * 1000).toISOString();
    const stageExternalId =
      stageName === '1st Round'
        ? 'stage:preliminary'
        : stageName === 'Fase de grupos'
          ? 'stage:groups'
          : 'stage:finals';
    const definition = stageName === 'Knockout Round Play-offs' ? playoffDefinition(match) : null;
    const roundExternalId =
      stageName === '1st Round'
        ? 'round:preliminary'
        : stageName === 'Fase de grupos'
          ? `round:group-${groupRound(startsAt)}`
          : 'round:playoffs';
    const groupName = groupByTeam.get(home.externalId);
    const playoffLegs = definition
      ? playoffMatches
          .filter((candidate) => playoffDefinition(candidate).key === definition.key)
          .sort((left, right) => left.matchInfo.date - right.matchInfo.date)
      : [];
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
      kickoffConfirmed: !match.matchInfo.tbc,
      status: statusOf(match),
      stageExternalId,
      roundExternalId,
      ...(stageName === '1st Round'
        ? { tieExternalId: `tie:preliminary:${match.matchInfo.externalId}`, legNumber: 1 }
        : definition
          ? {
              tieExternalId: `tie:${definition.key}`,
              legNumber: (playoffLegs.findIndex(
                (candidate) => candidate.matchInfo.externalId === match.matchInfo.externalId,
              ) + 1) as 1 | 2,
            }
          : {}),
      ...(groupName ? { groupName } : {}),
      ...(venue ? { venue } : {}),
      providerMetadata: {
        legacyId: match.matchInfo.legacyId,
        officialPath: match.matchInfo.path,
        rawStage: stageName,
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
      qualification: row.rank === 1 ? 'QUALIFIED' : row.rank === 2 ? 'PLAYOFF' : 'ELIMINATED',
      providerMetadata: { rankStatus: row.rankStatus, lastSix: row.lastSix },
    }));
  });

  const unknownPlaceholders = matches.filter((match) =>
    (match.matchInfo.contestant as JsonRecord[]).some(
      (team) => !team.externalId || team.name === 'Unknown',
    ),
  );
  const rawSnapshot = {
    schemaVersion: 2 as const,
    provider: 'conmebol-official',
    competition: 'conmebol-sudamericana',
    season: '2026',
    source: MANUAL_PAGE_URL,
    collectedAt: localCollectedAt(),
    collectionTimezone: 'America/Sao_Paulo',
    sourceOffset: '-03:00',
    metadata: {
      tournamentCalendarId: calendarId,
      officialFixtureCount: matches.length,
      excludedUnknownPlaceholderCount: unknownPlaceholders.length,
      excludedUnknownPlaceholderExternalIds: unknownPlaceholders.map(
        (match) => match.matchInfo.externalId,
      ),
      scoreableFrom: '2026-08-12T12:00:00.000Z',
      scoreableCutoffBasis:
        'First official future Round-of-16 feed slot; kickoff remains TBC and public writes stay disabled pending revalidation.',
      transferredLibertadoresTeamIds: [...transferredTeamIds].sort(),
      officialStandingsPage: TABLE_URL,
      officialStandingsFeed: standingsUrl,
    },
    artifacts,
    data: {
      teams,
      structure,
      ties,
      schedule,
      results,
      standings,
    },
  };
  const snapshot = {
    ...rawSnapshot,
    snapshotChecksum: computeOfficialSnapshotChecksum(rawSnapshot as never),
  };
  parseOfficialSourceSnapshot(snapshot, {
    provider: 'conmebol-official',
    competition: 'conmebol-sudamericana',
  });
  if (teams.length !== 56 || schedule.length !== 128 || standings.length !== 32) {
    throw new Error(
      `Unexpected official cardinality: ${teams.length} teams, ${schedule.length} matches, ${standings.length} standings.`,
    );
  }
  if (transferredTeamIds.size !== 8 || unknownPlaceholders.length !== 16) {
    throw new Error(
      `Unexpected transfer/TBC cardinality: ${transferredTeamIds.size} transfers, ${unknownPlaceholders.length} placeholders.`,
    );
  }
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        output,
        collectedAt: snapshot.collectedAt,
        checksum: snapshot.snapshotChecksum,
        artifacts: artifacts.map(({ source, checksum, byteLength }) => ({
          source,
          checksum,
          byteLength,
        })),
        counts: {
          teams: teams.length,
          structure: structure.length,
          ties: ties.length,
          schedule: schedule.length,
          results: results.length,
          standings: standings.length,
          excludedTbcPlaceholders: unknownPlaceholders.length,
          libertadoresTransfers: transferredTeamIds.size,
        },
      },
      null,
      2,
    ),
  );
}

await main();
