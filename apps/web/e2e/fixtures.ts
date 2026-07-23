import type { Page, Route } from '@playwright/test';

export const currentUser = {
  id: 'user-current',
  username: 'maria',
  nickname: 'Maria',
  avatarUrl: null,
  role: 'USER',
  status: 'ACTIVE',
};

const brazil = { id: 'team-brazil', name: 'Brasil', code: 'BRA', flagUrl: null, crestUrl: null };
const argentina = {
  id: 'team-argentina',
  name: 'Argentina',
  code: 'ARG',
  flagUrl: null,
  crestUrl: null,
};
const santos = { id: 'team-santos', name: 'Santos FC', code: 'SAN', flagUrl: null, crestUrl: null };
const vasco = {
  id: 'team-vasco',
  name: 'Vasco da Gama',
  code: 'VAS',
  flagUrl: null,
  crestUrl: null,
};
const nacional = {
  id: 'team-nacional',
  name: 'Nacional',
  code: 'NAC',
  flagUrl: null,
  crestUrl: null,
};
const penarol = {
  id: 'team-penarol',
  name: 'Peñarol',
  code: 'PEN',
  flagUrl: null,
  crestUrl: null,
};
const stage = { id: 'stage-league', name: 'Série A', type: 'LEAGUE' };
const hybridStage = { id: 'stage-hybrid', name: 'Grupo A', type: 'GROUP' };
const hybridKnockoutStage = {
  id: 'stage-hybrid-knockout',
  name: 'Eliminatórias',
  type: 'KNOCKOUT',
};
const libertadoresGroupStage = { id: 'stage-lib-groups', name: 'Fase de grupos', type: 'GROUP' };
const libertadoresKnockoutStage = {
  id: 'stage-lib-knockout',
  name: 'Eliminatórias',
  type: 'KNOCKOUT',
};
const sulamericanaGroupStage = { id: 'stage-sula-groups', name: 'Fase de grupos', type: 'GROUP' };
const sulamericanaKnockoutStage = {
  id: 'stage-sula-knockout',
  name: 'Eliminatórias',
  type: 'KNOCKOUT',
};
const copaKnockoutStage = { id: 'stage-copa-knockout', name: 'Mata-mata', type: 'KNOCKOUT' };
const pagination = { page: 1, pageSize: 100, total: 1, totalPages: 1 };
const worldSeason = {
  id: 'season-world',
  competitionId: 'competition-world',
  slug: 'world-cup-2026',
  name: 'Copa do Mundo 2026',
  year: 2026,
  timezone: 'America/Sao_Paulo',
  status: 'ACTIVE',
  startsAt: '2026-06-01T00:00:00.000Z',
  endsAt: '2026-07-31T00:00:00.000Z',
  capabilities: {
    workspace: 'WORLD_CUP_LEGACY',
    groupStage: true,
    knockoutBracket: true,
    liveScoring: true,
  },
};
const leagueSeason = {
  id: 'season-league',
  competitionId: 'competition-league',
  slug: 'brasileirao-serie-a-2026',
  name: 'Brasileirão Série A 2026',
  year: 2026,
  timezone: 'America/Sao_Paulo',
  status: 'ACTIVE',
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: null,
  capabilities: { format: 'LEAGUE', rounds: 38, teams: 20, lastFiveUnit: 'MATCH' },
};
const hybridSeason = {
  id: 'season-hybrid',
  competitionId: 'competition-hybrid',
  slug: 'torneio-hibrido-2026',
  name: 'Torneio Híbrido 2026',
  year: 2026,
  timezone: 'America/Sao_Paulo',
  status: 'ACTIVE',
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-12-20T00:00:00.000Z',
  capabilities: {
    format: 'GROUPS',
    groupStage: true,
    standings: true,
    knockout: true,
    twoLegs: true,
    rankingScopes: ['OVERALL', 'ROUND'],
  },
};
const libertadoresSeason = {
  id: 'season-libertadores',
  competitionId: 'competition-libertadores',
  slug: 'libertadores-2026',
  name: 'Libertadores 2026',
  year: 2026,
  timezone: 'America/Sao_Paulo',
  status: 'ACTIVE',
  startsAt: '2026-02-03T00:00:00.000Z',
  endsAt: '2026-11-28T00:00:00.000Z',
  capabilities: {
    format: 'GROUPS',
    groupStage: true,
    standings: true,
    knockout: true,
    twoLegs: true,
    rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
  },
};
const sulamericanaSeason = {
  id: 'season-sulamericana',
  competitionId: 'competition-sulamericana',
  slug: 'sul-americana-2026',
  name: 'Sul-Americana 2026',
  year: 2026,
  timezone: 'America/Sao_Paulo',
  status: 'ACTIVE',
  startsAt: '2026-03-03T00:00:00.000Z',
  endsAt: '2026-11-21T00:00:00.000Z',
  capabilities: {
    format: 'GROUPS',
    groupStage: true,
    standings: true,
    knockout: true,
    twoLegs: true,
    rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
  },
};
const copaDoBrasilSeason = {
  id: 'season-copa-do-brasil',
  competitionId: 'competition-copa-do-brasil',
  slug: 'copa-do-brasil-2026',
  name: 'Copa do Brasil 2026',
  year: 2026,
  timezone: 'America/Sao_Paulo',
  status: 'ACTIVE',
  startsAt: '2026-02-18T00:00:00.000Z',
  endsAt: '2026-12-06T00:00:00.000Z',
  capabilities: {
    format: 'KNOCKOUT',
    knockout: true,
    twoLegs: true,
    rankingScopes: ['OVERALL', 'ROUND'],
  },
};
const leagueSeason2025 = {
  ...leagueSeason,
  id: 'season-league-2025',
  slug: 'brasileirao-serie-a-2025',
  name: 'Brasileirão Série A 2025',
  year: 2025,
  status: 'FINISHED',
  startsAt: '2025-01-01T00:00:00.000Z',
};

const round = {
  id: 'round-19',
  seasonId: leagueSeason.id,
  stageId: stage.id,
  name: 'Rodada 19',
  order: 19,
  status: 'ACTIVE',
  startsAt: '2026-07-16T22:30:00.000Z',
  endsAt: '2026-07-23T22:30:00.000Z',
  stage,
};
const postponedRound = {
  id: 'round-4',
  seasonId: leagueSeason.id,
  stageId: stage.id,
  name: 'Rodada 4',
  order: 4,
  status: 'ACTIVE',
  startsAt: '2026-02-25T22:00:00.000Z',
  endsAt: '2026-07-17T00:30:00.000Z',
  stage,
};
const hybridRound = {
  id: 'round-hybrid-1',
  seasonId: hybridSeason.id,
  stageId: hybridStage.id,
  name: 'Rodada 1',
  order: 1,
  status: 'ACTIVE',
  startsAt: '2026-07-16T22:30:00.000Z',
  endsAt: '2026-07-23T22:30:00.000Z',
  stage: hybridStage,
};
const hybridKnockoutRound = {
  id: 'round-hybrid-semi',
  seasonId: hybridSeason.id,
  stageId: hybridKnockoutStage.id,
  name: 'Semifinal',
  order: 2,
  status: 'SCHEDULED',
  startsAt: '2026-10-21T22:00:00.000Z',
  endsAt: '2026-10-29T02:00:00.000Z',
  stage: hybridKnockoutStage,
};
const libertadoresGroupRound = {
  id: 'round-lib-groups',
  seasonId: libertadoresSeason.id,
  stageId: libertadoresGroupStage.id,
  name: 'Rodada 1',
  order: 1,
  status: 'ACTIVE',
  startsAt: '2026-04-07T22:00:00.000Z',
  endsAt: '2026-04-10T02:00:00.000Z',
  stage: libertadoresGroupStage,
};
const libertadoresKnockoutRound = {
  id: 'round-lib-semi',
  seasonId: libertadoresSeason.id,
  stageId: libertadoresKnockoutStage.id,
  name: 'Semifinal',
  order: 2,
  status: 'SCHEDULED',
  startsAt: '2026-10-21T22:00:00.000Z',
  endsAt: '2026-10-29T02:00:00.000Z',
  stage: libertadoresKnockoutStage,
};
const sulamericanaGroupRound = {
  id: 'round-sula-groups',
  seasonId: sulamericanaSeason.id,
  stageId: sulamericanaGroupStage.id,
  name: 'Rodada 1',
  order: 1,
  status: 'ACTIVE',
  startsAt: '2026-04-09T22:00:00.000Z',
  endsAt: '2026-04-10T02:00:00.000Z',
  stage: sulamericanaGroupStage,
};
const sulamericanaKnockoutRound = {
  id: 'round-sula-semi',
  seasonId: sulamericanaSeason.id,
  stageId: sulamericanaKnockoutStage.id,
  name: 'Semifinal',
  order: 2,
  status: 'SCHEDULED',
  startsAt: '2026-10-21T22:00:00.000Z',
  endsAt: '2026-10-29T02:00:00.000Z',
  stage: sulamericanaKnockoutStage,
};
const copaSemiRound = {
  id: 'round-copa-semi',
  seasonId: copaDoBrasilSeason.id,
  stageId: copaKnockoutStage.id,
  name: 'Semifinal',
  order: 1,
  status: 'ACTIVE',
  startsAt: '2026-10-21T22:00:00.000Z',
  endsAt: '2026-10-29T02:00:00.000Z',
  stage: copaKnockoutStage,
};
const copaFinalRound = {
  id: 'round-copa-final',
  seasonId: copaDoBrasilSeason.id,
  stageId: copaKnockoutStage.id,
  name: 'Final',
  order: 2,
  status: 'SCHEDULED',
  startsAt: '2026-12-06T22:00:00.000Z',
  endsAt: null,
  stage: copaKnockoutStage,
};
const genericMatch = {
  id: 'match-1',
  seasonId: leagueSeason.id,
  stageId: stage.id,
  roundId: round.id,
  matchDayId: 'day-1',
  startsAt: '2026-07-16T22:30:00.000Z',
  predictionClosesAt: '2026-07-16T22:25:00.000Z',
  status: 'SCHEDULED',
  homeScore: null,
  awayScore: null,
  finalHomeScore: null,
  finalAwayScore: null,
  homeTeam: brazil,
  awayTeam: argentina,
};
const postponedMatch = {
  ...genericMatch,
  id: 'match-postponed-round',
  matchDayId: 'day-postponed-round',
  roundId: postponedRound.id,
  startsAt: '2026-07-17T00:30:00.000Z',
  predictionClosesAt: '2026-07-17T00:25:00.000Z',
  homeTeam: santos,
  awayTeam: vasco,
};
const nextDayMatch = {
  ...genericMatch,
  id: 'match-next-day',
  matchDayId: 'day-2',
  startsAt: '2026-07-17T23:00:00.000Z',
  predictionClosesAt: '2026-07-17T22:55:00.000Z',
  homeTeam: argentina,
  awayTeam: brazil,
};
const leagueMatches = [genericMatch, postponedMatch, nextDayMatch];
const hybridMatch = {
  ...genericMatch,
  id: 'match-hybrid-1',
  seasonId: hybridSeason.id,
  stageId: hybridStage.id,
  roundId: hybridRound.id,
  matchDayId: 'day-hybrid-1',
};
const libertadoresMatch = {
  ...hybridMatch,
  id: 'match-lib-groups',
  seasonId: libertadoresSeason.id,
  stageId: libertadoresGroupStage.id,
  roundId: libertadoresGroupRound.id,
  matchDayId: 'day-lib-groups',
  homeTeam: nacional,
  awayTeam: penarol,
};
const sulamericanaMatch = {
  ...hybridMatch,
  id: 'match-sula-groups',
  seasonId: sulamericanaSeason.id,
  stageId: sulamericanaGroupStage.id,
  roundId: sulamericanaGroupRound.id,
  matchDayId: 'day-sula-groups',
  homeTeam: penarol,
  awayTeam: nacional,
};
const copaSemiFirstLeg = {
  ...genericMatch,
  id: 'match-copa-semi-1',
  seasonId: copaDoBrasilSeason.id,
  stageId: copaKnockoutStage.id,
  roundId: copaSemiRound.id,
  tieId: 'tie-copa-semi',
  legNumber: 1,
  matchDayId: 'day-copa-semi-1',
  status: 'FINISHED',
  homeScore: 1,
  awayScore: 1,
  finalHomeScore: 1,
  finalAwayScore: 1,
  regulationHomeScore: 1,
  regulationAwayScore: 1,
  homeTeam: santos,
  awayTeam: vasco,
};
const copaSemiSecondLeg = {
  ...copaSemiFirstLeg,
  id: 'match-copa-semi-2',
  legNumber: 2,
  matchDayId: 'day-copa-semi-2',
  homeScore: 1,
  awayScore: 1,
  finalHomeScore: 1,
  finalAwayScore: 1,
  regulationHomeScore: 1,
  regulationAwayScore: 1,
  penaltyHomeScore: 4,
  penaltyAwayScore: 3,
  homeTeam: vasco,
  awayTeam: santos,
};
const copaFinal = {
  ...genericMatch,
  id: 'match-copa-final',
  seasonId: copaDoBrasilSeason.id,
  stageId: copaKnockoutStage.id,
  roundId: copaFinalRound.id,
  tieId: 'tie-copa-final',
  legNumber: 1,
  matchDayId: 'day-copa-final',
  status: 'SCHEDULED',
  homeTeam: vasco,
  awayTeam: santos,
};
const standing = (rank: number, team: typeof brazil, points: number) => ({
  rank,
  group: 'Série A',
  team,
  played: 19,
  wins: rank === 1 ? 12 : 11,
  draws: 4,
  losses: rank === 1 ? 3 : 4,
  goalsFor: 30,
  goalsAgainst: 14,
  goalDifference: 16,
  points,
  yellowCards: 20,
  redCards: 1,
  tieBreakRuleVersion: 'cbf-rec-2026-art-15-v1',
  lastFive: ['W', 'W', 'D'],
});
const rankingRow = (rank: number, userId: string, nickname: string, points: number) => ({
  rank,
  userId,
  nickname,
  avatarUrl: null,
  points,
  finalPoints: points,
  played: 4,
  exactScores: rank === 1 ? 2 : 1,
  resultHits: 2,
  oneGoalHits: 1,
  misses: 0,
  lastFive: [15, 3],
  lastFiveMatches: [],
  hasLiveData: false,
});
const ranking = [
  rankingRow(1, 'user-leader', 'Ana', 24),
  rankingRow(2, currentUser.id, currentUser.nickname, 21),
];
const leagueTeamSummaries = [
  {
    team: santos,
    externalId: '20008',
    state: 'SP',
    profileAvailable: true,
    collectedAt: '2026-07-16T12:00:00.000Z',
  },
  {
    team: vasco,
    externalId: '60646',
    state: 'RJ',
    profileAvailable: true,
    collectedAt: '2026-07-16T12:00:00.000Z',
  },
];
const hybridTeamSummaries = [
  { team: brazil, externalId: 'brazil', state: null, profileAvailable: false, collectedAt: null },
  {
    team: argentina,
    externalId: 'argentina',
    state: null,
    profileAvailable: false,
    collectedAt: null,
  },
];
const cupTeams = [
  {
    team: nacional,
    externalId: 'nacional',
    state: null,
    profileAvailable: false,
    collectedAt: null,
  },
  { team: penarol, externalId: 'penarol', state: null, profileAvailable: false, collectedAt: null },
  { team: santos, externalId: 'santos', state: 'SP', profileAvailable: false, collectedAt: null },
  { team: vasco, externalId: 'vasco', state: 'RJ', profileAvailable: false, collectedAt: null },
];
const libertadoresTie = {
  id: 'tie-lib-semi',
  seasonId: libertadoresSeason.id,
  stageId: libertadoresKnockoutStage.id,
  roundId: libertadoresKnockoutRound.id,
  key: 'semi-1',
  order: 1,
  expectedLegs: 2,
  status: 'SCHEDULED',
  decisionMethod: null,
  aggregateTeamAScore: null,
  aggregateTeamBScore: null,
  decidedAt: null,
  lastRecomputedAt: '2026-07-16T12:00:00.000Z',
  provenance: 'e2e-fixture',
  metadata: null,
  teamA: nacional,
  teamB: penarol,
  winnerTeam: null,
  matches: [
    {
      ...libertadoresMatch,
      id: 'match-lib-semi-1',
      stageId: libertadoresKnockoutStage.id,
      roundId: libertadoresKnockoutRound.id,
      tieId: 'tie-lib-semi',
      legNumber: 1,
    },
    {
      ...libertadoresMatch,
      id: 'match-lib-semi-2',
      stageId: libertadoresKnockoutStage.id,
      roundId: libertadoresKnockoutRound.id,
      tieId: 'tie-lib-semi',
      legNumber: 2,
      homeTeam: penarol,
      awayTeam: nacional,
    },
  ],
};
const hybridTie = {
  ...libertadoresTie,
  id: 'tie-hybrid-semi',
  seasonId: hybridSeason.id,
  stageId: hybridKnockoutStage.id,
  roundId: hybridKnockoutRound.id,
  teamA: brazil,
  teamB: argentina,
  matches: [
    {
      ...hybridMatch,
      id: 'match-hybrid-semi-1',
      stageId: hybridKnockoutStage.id,
      roundId: hybridKnockoutRound.id,
      tieId: 'tie-hybrid-semi',
      legNumber: 1,
    },
    {
      ...hybridMatch,
      id: 'match-hybrid-semi-2',
      stageId: hybridKnockoutStage.id,
      roundId: hybridKnockoutRound.id,
      tieId: 'tie-hybrid-semi',
      legNumber: 2,
      homeTeam: argentina,
      awayTeam: brazil,
    },
  ],
};
const sulamericanaTie = {
  ...libertadoresTie,
  id: 'tie-sula-semi',
  seasonId: sulamericanaSeason.id,
  stageId: sulamericanaKnockoutStage.id,
  roundId: sulamericanaKnockoutRound.id,
  teamA: penarol,
  teamB: nacional,
  matches: [
    {
      ...sulamericanaMatch,
      id: 'match-sula-semi-1',
      stageId: sulamericanaKnockoutStage.id,
      roundId: sulamericanaKnockoutRound.id,
      tieId: 'tie-sula-semi',
      legNumber: 1,
    },
    {
      ...sulamericanaMatch,
      id: 'match-sula-semi-2',
      stageId: sulamericanaKnockoutStage.id,
      roundId: sulamericanaKnockoutRound.id,
      tieId: 'tie-sula-semi',
      legNumber: 2,
      homeTeam: nacional,
      awayTeam: penarol,
    },
  ],
};
const copaTies = [
  {
    id: 'tie-copa-semi',
    seasonId: copaDoBrasilSeason.id,
    stageId: copaKnockoutStage.id,
    roundId: copaSemiRound.id,
    key: 'semi-1',
    order: 1,
    expectedLegs: 2,
    status: 'DECIDED',
    decisionMethod: 'PENALTIES',
    aggregateTeamAScore: 2,
    aggregateTeamBScore: 2,
    decidedAt: '2026-10-29T22:00:00.000Z',
    lastRecomputedAt: '2026-10-29T22:00:00.000Z',
    provenance: 'e2e-fixture',
    metadata: null,
    teamA: santos,
    teamB: vasco,
    winnerTeam: vasco,
    matches: [copaSemiFirstLeg, copaSemiSecondLeg],
  },
  {
    id: 'tie-copa-final',
    seasonId: copaDoBrasilSeason.id,
    stageId: copaKnockoutStage.id,
    roundId: copaFinalRound.id,
    key: 'final',
    order: 1,
    expectedLegs: 1,
    status: 'SCHEDULED',
    decisionMethod: null,
    aggregateTeamAScore: null,
    aggregateTeamBScore: null,
    decidedAt: null,
    lastRecomputedAt: '2026-11-15T22:00:00.000Z',
    provenance: 'e2e-fixture',
    metadata: null,
    teamA: vasco,
    teamB: santos,
    winnerTeam: null,
    matches: [copaFinal],
  },
];
const cupFixtures = [
  {
    competition: {
      id: 'competition-libertadores',
      slug: 'libertadores',
      name: 'Libertadores',
      capabilities: libertadoresSeason.capabilities,
      presentation: { label: 'CONMEBOL', theme: { accent: '#f4d65c', surface: '#473b18' } },
    },
    season: libertadoresSeason,
    rounds: [libertadoresGroupRound, libertadoresKnockoutRound],
    matches: [libertadoresMatch],
    standingsByGroup: [{ group: 'A', rows: [standing(1, nacional, 3), standing(2, penarol, 0)] }],
    ties: [libertadoresTie],
    poolSeasonId: 'pool-season-libertadores',
  },
  {
    competition: {
      id: 'competition-sulamericana',
      slug: 'sul-americana',
      name: 'Sul-Americana',
      capabilities: sulamericanaSeason.capabilities,
      presentation: { label: 'CONMEBOL', theme: { accent: '#e89bc8', surface: '#4b1d3b' } },
    },
    season: sulamericanaSeason,
    rounds: [sulamericanaGroupRound, sulamericanaKnockoutRound],
    matches: [sulamericanaMatch],
    standingsByGroup: [{ group: 'A', rows: [standing(1, penarol, 3), standing(2, nacional, 0)] }],
    ties: [sulamericanaTie],
    poolSeasonId: 'pool-season-sulamericana',
  },
  {
    competition: {
      id: 'competition-copa-do-brasil',
      slug: 'copa-do-brasil',
      name: 'Copa do Brasil',
      capabilities: copaDoBrasilSeason.capabilities,
      presentation: { label: 'Copa nacional', theme: { accent: '#72b7f2', surface: '#123756' } },
    },
    season: copaDoBrasilSeason,
    rounds: [copaSemiRound, copaFinalRound],
    matches: [copaSemiFirstLeg, copaFinal],
    standingsByGroup: [],
    ties: copaTies,
    poolSeasonId: 'pool-season-copa-do-brasil',
  },
];
const vascoProfile = {
  seasonId: leagueSeason.id,
  team: vasco,
  externalId: '60646',
  state: 'RJ',
  athletes: [
    {
      externalId: 'athlete-1',
      fullName: 'João da Silva',
      nickname: 'João',
      currentClub: { externalId: '60646', name: 'Vasco da Gama', state: 'RJ' },
    },
    {
      externalId: 'athlete-2',
      fullName: 'Carlos de Souza',
      nickname: 'Carlos',
      currentClub: { externalId: '20385', name: 'Mirassol', state: 'SP' },
    },
  ],
  matches: [
    {
      externalId: '832001',
      reference: '112',
      round: 12,
      startsAt: '2026-04-18T21:30:00.000Z',
      home: { externalId: '60646', name: 'Vasco da Gama', score: 2 },
      away: { externalId: '20005', name: 'São Paulo', score: 1 },
      venue: 'São Januário - Rio de Janeiro - RJ',
      result: 'WIN',
    },
  ],
  statistics: {
    goalsFor: 22,
    goalsAgainst: 29,
    cleanSheets: 1,
    played: 18,
    wins: 5,
    draws: 5,
    losses: 8,
    yellowCards: 40,
    redCards: 3,
  },
  source: {
    provider: 'CBF',
    label: 'Confederação Brasileira de Futebol',
    url: 'https://www.cbf.com.br/futebol-brasileiro/times/campeonato-brasileiro/serie-a/2026/60646',
    collectedAt: '2026-07-16T12:00:00.000Z',
    checksum: 'a'.repeat(64),
  },
};

function apiError(status: number) {
  const messages: Record<number, string> = {
    401: 'Sessão expirada',
    403: 'Acesso negado',
    409: 'Palpite fechado',
    500: 'Falha interna',
  };
  return {
    error: {
      status,
      code: `TEST_${status}`,
      message: messages[status],
      issues: [],
      requestId: `request-${status}`,
    },
  };
}

export async function installApiMocks(
  page: Page,
  options: {
    authenticated?: boolean;
    loginStatus?: number;
    admin?: boolean;
    closed?: boolean;
  } = {},
) {
  await page.clock.setFixedTime(new Date('2026-07-16T12:00:00.000Z'));
  let authenticated = options.authenticated ?? true;
  const signedInUser = options.admin ? { ...currentUser, role: 'ADMIN' } : currentUser;
  let managedUser = {
    ...currentUser,
    id: 'user-managed',
    username: 'joao',
    nickname: 'João',
    status: 'ACTIVE',
  };
  let leaguePredictions: Array<{
    id: string;
    poolSeasonId: string;
    userId: string;
    matchId: string;
    predictedHomeScore: number;
    predictedAwayScore: number;
    updatedAt: string;
  }> = [];
  const predictionBoard = {
    checkedAt: '2026-07-15T12:00:00.000Z',
    predictionCloseMinutes: 5,
    canPredict: !options.closed,
    groupStageComplete: true,
    groups: [
      {
        group: 'A',
        standings: [
          {
            rank: 1,
            team: brazil,
            played: 3,
            wins: 2,
            draws: 1,
            losses: 0,
            goalsFor: 5,
            goalsAgainst: 1,
            goalDifference: 4,
            points: 7,
          },
          {
            rank: 2,
            team: argentina,
            played: 3,
            wins: 2,
            draws: 0,
            losses: 1,
            goalsFor: 4,
            goalsAgainst: 2,
            goalDifference: 2,
            points: 6,
          },
        ],
        matches: [],
      },
    ],
    knockout: {
      generation: {
        id: 'generation-1',
        sequence: 1,
        mode: 'PROVISIONAL',
        status: 'ACTIVE',
        closesAt: '2026-12-01T00:00:00.000Z',
        isOpen: true,
      },
      fixtures: [
        {
          id: 'fixture-73',
          matchNumber: 73,
          stage: 'ROUND_OF_32',
          startsAt: '2026-12-03T18:00:00.000Z',
          homeSource: '1A',
          awaySource: '2A',
          status: 'SCHEDULED',
          homeTeam: brazil,
          awayTeam: argentina,
          winnerTeam: null,
        },
      ],
      roundOf32: [{ matchNumber: 73, homeTeamId: brazil.id, awayTeamId: argentina.id }],
      resolvedGroups: ['A'],
      savedBracket: null,
    },
  };

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/events') return route.continue();
    if (path === '/api/auth/csrf') return json({ csrfToken: 'x'.repeat(40) });
    if (path === '/api/auth/me')
      return authenticated ? json({ user: signedInUser }) : json(apiError(401), 401);
    if (path === '/api/auth/login') {
      if (options.loginStatus) return json(apiError(options.loginStatus), options.loginStatus);
      authenticated = true;
      return json({ user: signedInUser });
    }
    if (path === '/api/auth/logout') {
      authenticated = false;
      return json({}, 204);
    }
    if (path === '/api/admin/overview')
      return json({
        seasons: [
          {
            ...leagueSeason,
            rounds: [round],
            poolSeasons: [
              {
                id: 'pool-season-league',
                scoringRuleSetVersionId: 'rules-v1',
                pool: { name: 'Bolão fixture' },
              },
            ],
            _count: { matches: 1, teams: 2 },
            featureFlags: {
              readEnabled: false,
              writeEnabled: false,
              uiEnabled: false,
              syncEnabled: false,
              reason: 'Fixture local de canário',
              updatedAt: '2026-07-15T12:00:00.000Z',
              updatedById: signedInUser.id,
            },
            refresh: {
              available: true,
              providers: [
                {
                  providerKey: 'cbf-official',
                  enabledTypes: ['TEAMS', 'SCHEDULE', 'RESULTS', 'STANDINGS'],
                  includeProfiles: true,
                  source: 'https://www.cbf.com.br/fixture-oficial',
                  provenance: 'e2e-fixture',
                },
              ],
              lastRun: null,
            },
          },
        ],
      });
    if (path === '/api/admin/divergences')
      return json({
        quarantine: [],
        overrides: [{ id: 'override-fixture', provenance: 'MANUAL', rollback: true }],
        mappings: [],
        runs: [{ id: 'run-fixture' }],
      });
    if (path === '/api/admin/jobs') return json({ jobs: [] });
    if (path === '/api/admin/audit') return json({ logs: [{ id: 'audit-fixture' }] });
    if (path === '/api/admin/health')
      return json({
        checkedAt: '2026-07-15T12:00:00.000Z',
        provider: { ok: true },
        sse: { ok: true },
        backup: { ok: true },
      });
    if (path === '/api/admin/teams') return json({ teams: [brazil, argentina] });
    if (path === '/api/admin/users') return json({ users: [signedInUser, managedUser] });
    if (path === '/api/admin/settings/predictions')
      return json({ predictionCloseMinutes: 5, reopenedMatches: 0, closedMatches: 0 });
    if (path === '/api/admin/settings/score-sync')
      return json({ enabled: true, updatedAt: '2026-07-15T12:00:00.000Z' });
    if (path === '/api/admin/seed-worldcup-2026' && method === 'POST')
      return json({ teams: 48, matches: 72 });
    if (
      path === `/api/admin/seasons/${leagueSeason.id}/refresh-competition-data` &&
      method === 'POST'
    )
      return json({
        status: 'UNCHANGED',
        changedMatches: 0,
        updatedProfiles: 0,
        lastSyncedAt: '2026-07-16T12:00:00.000Z',
        featureFlagsUnchanged: true,
        featureFlags: {
          readEnabled: false,
          writeEnabled: false,
          uiEnabled: false,
          syncEnabled: false,
          reason: 'Fixture local de canário',
          updatedAt: '2026-07-15T12:00:00.000Z',
          updatedById: signedInUser.id,
        },
        supplemental: [],
        runs: [
          {
            runId: 'run-admin-refresh',
            provider: 'cbf-official',
            type: 'RESULTS',
            status: 'SUCCESS',
            source: 'https://www.cbf.com.br/fixture-oficial',
            collectedAt: '2026-07-16T12:00:00.000Z',
            checksum: 'a'.repeat(64),
            counts: {
              fetched: 10,
              inserted: 0,
              updated: 0,
              unchanged: 10,
              quarantined: 0,
            },
            reused: false,
            startedAt: '2026-07-16T11:59:59.000Z',
            finishedAt: '2026-07-16T12:00:00.000Z',
          },
        ],
      });
    if (path === `/api/admin/users/${managedUser.id}/status` && method === 'PATCH') {
      managedUser = { ...managedUser, status: 'BLOCKED' };
      return json({ user: managedUser });
    }
    if (path === `/api/admin/seasons/${leagueSeason.id}/features` && method === 'GET')
      return json({
        flags: {
          readEnabled: true,
          writeEnabled: true,
          uiEnabled: true,
          syncEnabled: false,
          reason: 'Fixture local de canário',
          updatedAt: '2026-07-15T12:00:00.000Z',
          updatedById: signedInUser.id,
        },
      });
    if (path === `/api/admin/seasons/${leagueSeason.id}/features` && method === 'PUT')
      return json({
        flags: {
          ...JSON.parse(request.postData() ?? '{}'),
          updatedAt: '2026-07-15T12:01:00.000Z',
          updatedById: signedInUser.id,
        },
      });
    if (path === '/api/competitions')
      return json({
        competitions: [
          {
            id: 'competition-world',
            slug: 'world-cup',
            name: 'Copa do Mundo',
            capabilities: {
              workspace: 'WORLD_CUP_LEGACY',
              groupStage: true,
              knockoutBracket: true,
              liveScoring: true,
            },
          },
          {
            id: 'competition-league',
            slug: 'brasileirao-serie-a',
            name: 'Brasileirão Série A',
            capabilities: {
              format: 'LEAGUE',
              standings: true,
              knockout: false,
              rankingScopes: ['OVERALL', 'ROUND', 'MONTH', 'TURN'],
            },
          },
          {
            id: 'competition-hybrid',
            slug: 'torneio-hibrido',
            name: 'Torneio Híbrido',
            capabilities: {
              format: 'GROUPS',
              groupStage: true,
              standings: true,
              knockout: true,
              twoLegs: true,
              rankingScopes: ['OVERALL', 'ROUND'],
            },
          },
          ...cupFixtures.map((fixture) => fixture.competition),
        ],
        pagination: { ...pagination, total: 6 },
      });
    if (path.includes('/api/competitions/world-cup/seasons'))
      return json({
        competition: {
          id: 'competition-world',
          slug: 'world-cup',
          name: 'Copa do Mundo',
          capabilities: {
            workspace: 'WORLD_CUP_LEGACY',
            groupStage: true,
            knockoutBracket: true,
            liveScoring: true,
          },
        },
        seasons: [worldSeason],
        pagination,
      });
    if (path.includes('/api/competitions/brasileirao-serie-a/seasons'))
      return json({
        competition: {
          id: 'competition-league',
          slug: 'brasileirao-serie-a',
          name: 'Brasileirão Série A',
          capabilities: {
            format: 'LEAGUE',
            standings: true,
            knockout: false,
            rankingScopes: ['OVERALL', 'ROUND', 'MONTH', 'TURN'],
          },
        },
        seasons: [leagueSeason, leagueSeason2025],
        pagination: { ...pagination, total: 2 },
      });
    if (path.includes('/api/competitions/torneio-hibrido/seasons'))
      return json({
        competition: {
          id: 'competition-hybrid',
          slug: 'torneio-hibrido',
          name: 'Torneio Híbrido',
          capabilities: {
            format: 'GROUPS',
            groupStage: true,
            standings: true,
            knockout: true,
            twoLegs: true,
            rankingScopes: ['OVERALL', 'ROUND'],
          },
        },
        seasons: [hybridSeason],
        pagination,
      });
    const competitionFixture = cupFixtures.find((fixture) =>
      path.includes(`/api/competitions/${fixture.competition.slug}/seasons`),
    );
    if (competitionFixture)
      return json({
        competition: competitionFixture.competition,
        seasons: [competitionFixture.season],
        pagination,
      });
    const seasonFixture = cupFixtures.find(
      (fixture) =>
        path.startsWith(`/api/seasons/${fixture.season.id}/`) ||
        path.includes(`/api/pools/${POOL_SLUG}/seasons/${fixture.season.id}/`),
    );
    if (seasonFixture) {
      const { season: cupSeason } = seasonFixture;
      if (path === `/api/seasons/${cupSeason.id}/features`) return json({ uiEnabled: true });
      if (path === `/api/seasons/${cupSeason.id}/rounds`)
        return json({
          rounds: seasonFixture.rounds,
          pagination: { ...pagination, total: seasonFixture.rounds.length },
        });
      if (path === `/api/seasons/${cupSeason.id}/matches`)
        return json({
          matches: seasonFixture.matches,
          pagination: { ...pagination, total: seasonFixture.matches.length },
        });
      if (path === `/api/seasons/${cupSeason.id}/standings`)
        return json({
          standingsByGroup: seasonFixture.standingsByGroup,
          pagination: { ...pagination, total: seasonFixture.standingsByGroup.length * 2 },
        });
      if (path === `/api/seasons/${cupSeason.id}/ties`)
        return json({
          ties: seasonFixture.ties,
          pagination: { ...pagination, total: seasonFixture.ties.length },
        });
      if (path === `/api/seasons/${cupSeason.id}/teams`)
        return json({ teams: cupTeams, pagination: { ...pagination, total: cupTeams.length } });
      if (
        path.includes(`/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/predictions`) &&
        method === 'GET'
      )
        return json({ predictions: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
      if (
        path.includes(`/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/predictions`) &&
        method === 'PUT'
      )
        return json({ predictions: [] });
      if (path === `/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/rules`)
        return json({
          poolSeasonId: seasonFixture.poolSeasonId,
          scoring: {
            id: `rules-${cupSeason.id}`,
            key: 'cup-generic',
            name: 'Pontuação de copa',
            version: 1,
            rules: { exactScore: 15, correctOutcome: 3, oneTeamGoals: 1, miss: 0 },
          },
          tieBreakers: {
            id: `tie-${cupSeason.id}`,
            key: 'cup-generic',
            name: 'Desempate de copa',
            version: 1,
            allowSharedPositions: false,
            criteria: [{ field: 'exactScores', direction: 'desc', label: 'Placares exatos' }],
          },
          predictionPolicy: {
            scoreableFrom: null,
            scoreableFromRound: null,
            startsAtRound: null,
            historicalMatchesScoreable: false,
          },
        });
      if (path === `/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/engagement`)
        return json({
          achievements: [],
          streaks: [],
          notifications: [],
          preferences: {
            inAppEnabled: true,
            pushEnabled: false,
            emailEnabled: false,
            quietHoursEnabled: false,
            quietHoursStart: null,
            quietHoursEnd: null,
            timezone: 'America/Sao_Paulo',
          },
        });
      if (
        path.includes(`/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/ranking`) &&
        method === 'GET'
      )
        return json({ ranking, pagination: { ...pagination, total: ranking.length } });
      if (
        path === `/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/ranking/visit` &&
        method === 'POST'
      )
        return json({ summary: { previousRank: null, currentRank: 2, delta: null } });
      if (path === `/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/awards`)
        return json({ awards: [] });
      if (path === `/api/pools/${POOL_SLUG}/seasons/${cupSeason.id}/sync-status`)
        return json({ providers: [], lastSyncedAt: null, syncing: false });
    }
    if (path === `/api/seasons/${leagueSeason.id}/features`) return json({ uiEnabled: true });
    if (path === `/api/seasons/${leagueSeason2025.id}/features`) return json({ uiEnabled: true });
    if (path === `/api/seasons/${leagueSeason.id}/rounds`)
      return json({ rounds: [postponedRound, round], pagination: { ...pagination, total: 2 } });
    if (path === `/api/seasons/${leagueSeason.id}/matches`)
      return json({
        matches: leagueMatches,
        pagination: { ...pagination, total: leagueMatches.length },
      });
    if (path === `/api/seasons/${leagueSeason.id}/standings`)
      return json({
        standingsByGroup: [
          { group: 'Série A', rows: [standing(1, santos, 40), standing(2, vasco, 37)] },
        ],
        pagination: { ...pagination, total: 2 },
      });
    if (path === `/api/seasons/${leagueSeason.id}/teams`)
      return json({ teams: leagueTeamSummaries, pagination: { ...pagination, total: 2 } });
    if (path === `/api/seasons/${leagueSeason.id}/teams/${vasco.id}/profile`)
      return json({ profile: vascoProfile });
    if (
      path.includes(`/api/pools/${POOL_SLUG}/seasons/${leagueSeason.id}/predictions`) &&
      method === 'GET'
    )
      return json({
        predictions: leaguePredictions,
        pagination: {
          ...pagination,
          total: leaguePredictions.length,
          totalPages: leaguePredictions.length ? 1 : 0,
        },
      });
    if (
      path.includes(`/api/pools/${POOL_SLUG}/seasons/${leagueSeason.id}/predictions`) &&
      method === 'PUT'
    ) {
      const body = JSON.parse(request.postData() ?? '{}') as {
        predictions?: Array<{
          matchId: string;
          predictedHomeScore: number;
          predictedAwayScore: number;
        }>;
      };
      const saved = (body.predictions ?? []).map((prediction) => ({
        id: `prediction-${prediction.matchId}`,
        poolSeasonId: 'pool-season-league',
        userId: currentUser.id,
        ...prediction,
        updatedAt: '2026-07-16T12:30:00.000Z',
      }));
      leaguePredictions = [
        ...leaguePredictions.filter(
          (item) => !saved.some((entry) => entry.matchId === item.matchId),
        ),
        ...saved,
      ];
      return json({ predictions: saved });
    }
    if (path === `/api/pools/${POOL_SLUG}/seasons/${leagueSeason.id}/rules`)
      return json({
        poolSeasonId: 'pool-season-league',
        scoring: {
          id: 'rules-v1',
          key: 'classic',
          name: 'PontuaÃ§Ã£o clÃ¡ssica',
          version: 1,
          rules: { exactScore: 15, correctOutcome: 3, oneTeamGoals: 1, miss: 0 },
        },
        tieBreakers: {
          id: 'tie-v1',
          key: 'classic',
          name: 'Desempate clÃ¡ssico',
          version: 1,
          allowSharedPositions: false,
          criteria: [{ field: 'exactScores', direction: 'desc', label: 'Placares exatos' }],
        },
        predictionPolicy: {
          scoreableFrom: '2026-07-16T03:00:00.000Z',
          scoreableFromRound: null,
          startsAtRound: null,
          historicalMatchesScoreable: false,
        },
      });
    if (path === `/api/pools/${POOL_SLUG}/seasons/${leagueSeason.id}/engagement`)
      return json({
        achievements: [],
        streaks: [],
        notifications: [],
        preferences: {
          inAppEnabled: true,
          pushEnabled: false,
          emailEnabled: false,
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: 'America/Sao_Paulo',
        },
      });
    if (path.includes(`/api/pools/${POOL_SLUG}/seasons/${leagueSeason.id}/ranking`))
      return json({ ranking, pagination: { ...pagination, total: 2 } });
    if (path === `/api/seasons/${leagueSeason2025.id}/rounds`)
      return json({ rounds: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    if (path === `/api/seasons/${leagueSeason2025.id}/matches`)
      return json({ matches: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    if (path === `/api/seasons/${leagueSeason2025.id}/standings`)
      return json({ standingsByGroup: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    if (
      path.includes(`/api/pools/${POOL_SLUG}/seasons/${leagueSeason2025.id}/predictions`) &&
      method === 'GET'
    )
      return json({ predictions: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    if (path === `/api/pools/${POOL_SLUG}/seasons/${leagueSeason2025.id}/rules`)
      return json({
        poolSeasonId: 'pool-season-league-2025',
        scoring: {
          id: 'rules-v1',
          key: 'classic',
          name: 'Pontuação clássica',
          version: 1,
          rules: { exactScore: 15, correctOutcome: 3, oneTeamGoals: 1, miss: 0 },
        },
        tieBreakers: {
          id: 'tie-v1',
          key: 'classic',
          name: 'Desempate clássico',
          version: 1,
          allowSharedPositions: false,
          criteria: [{ field: 'exactScores', direction: 'desc', label: 'Placares exatos' }],
        },
        predictionPolicy: {
          scoreableFrom: null,
          scoreableFromRound: null,
          startsAtRound: null,
          historicalMatchesScoreable: false,
        },
      });
    if (path === `/api/pools/${POOL_SLUG}/seasons/${leagueSeason2025.id}/engagement`)
      return json({
        achievements: [],
        streaks: [],
        notifications: [],
        preferences: {
          inAppEnabled: true,
          pushEnabled: false,
          emailEnabled: false,
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: 'America/Sao_Paulo',
        },
      });
    if (path.includes(`/api/pools/${POOL_SLUG}/seasons/${leagueSeason2025.id}/ranking`))
      return json({ ranking: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    if (path === `/api/seasons/${hybridSeason.id}/features`) return json({ uiEnabled: true });
    if (path === `/api/seasons/${hybridSeason.id}/rounds`)
      return json({
        rounds: [hybridRound, hybridKnockoutRound],
        pagination: { ...pagination, total: 2 },
      });
    if (path === `/api/seasons/${hybridSeason.id}/matches`)
      return json({ matches: [hybridMatch], pagination });
    if (path === `/api/seasons/${hybridSeason.id}/standings`)
      return json({
        standingsByGroup: [
          { group: 'Grupo A', rows: [standing(1, brazil, 3), standing(2, argentina, 0)] },
        ],
        pagination: { ...pagination, total: 2 },
      });
    if (path === `/api/seasons/${hybridSeason.id}/ties`)
      return json({ ties: [hybridTie], pagination });
    if (path === `/api/seasons/${hybridSeason.id}/teams`)
      return json({ teams: hybridTeamSummaries, pagination: { ...pagination, total: 2 } });
    if (
      path.includes(`/api/pools/${POOL_SLUG}/seasons/${hybridSeason.id}/predictions`) &&
      method === 'GET'
    )
      return json({ predictions: [], pagination: { ...pagination, total: 0, totalPages: 0 } });
    if (path === `/api/pools/${POOL_SLUG}/seasons/${hybridSeason.id}/rules`)
      return json({
        poolSeasonId: 'pool-season-hybrid',
        scoring: {
          id: 'rules-hybrid',
          key: 'hybrid',
          name: 'Pontuação híbrida',
          version: 1,
          rules: { exactScore: 15, correctOutcome: 3, oneTeamGoals: 1, miss: 0 },
        },
        tieBreakers: {
          id: 'tie-hybrid',
          key: 'hybrid',
          name: 'Desempate híbrido',
          version: 1,
          allowSharedPositions: false,
          criteria: [{ field: 'exactScores', direction: 'desc', label: 'Placares exatos' }],
        },
        predictionPolicy: {
          scoreableFrom: null,
          scoreableFromRound: null,
          startsAtRound: null,
          historicalMatchesScoreable: false,
        },
      });
    if (path === `/api/pools/${POOL_SLUG}/seasons/${hybridSeason.id}/engagement`)
      return json({
        achievements: [],
        streaks: [],
        notifications: [],
        preferences: {
          inAppEnabled: true,
          pushEnabled: false,
          emailEnabled: false,
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          timezone: 'America/Sao_Paulo',
        },
      });
    if (
      path.includes(`/api/pools/${POOL_SLUG}/seasons/${hybridSeason.id}/ranking`) &&
      method === 'GET'
    )
      return json({ ranking, pagination: { ...pagination, total: 2 } });
    if (
      path === `/api/pools/${POOL_SLUG}/seasons/${hybridSeason.id}/ranking/visit` &&
      method === 'POST'
    )
      return json({ summary: { previousRank: null, currentRank: 2, delta: null } });
    if (path === `/api/pools/${POOL_SLUG}/seasons/${hybridSeason.id}/awards`)
      return json({ awards: [] });
    if (path === `/api/pools/${POOL_SLUG}/seasons/${hybridSeason.id}/sync-status`)
      return json({ providers: [], lastSyncedAt: null, syncing: false });
    if (path === '/api/match-days')
      return json({
        predictionCloseMinutes: 5,
        matchDays: [
          {
            id: 'day-1',
            date: '2026-12-02',
            firstMatchStartsAt: genericMatch.startsAt,
            predictionsCloseAt: genericMatch.predictionClosesAt,
            status: options.closed ? 'CLOSED' : 'OPEN',
            isOpenForPredictions: !options.closed,
            predictionsArePublic: Boolean(options.closed),
            matches: [
              {
                ...genericMatch,
                predictionsCloseAt: genericMatch.predictionClosesAt,
                isOpenForPredictions: !options.closed,
                predictionsArePublic: Boolean(options.closed),
                predictions: [],
                rawPayload: null,
              },
            ],
          },
        ],
      });
    if (path === '/api/match-days/day-1' && method === 'GET')
      return json({
        predictionCloseMinutes: 5,
        matchDay: {
          id: 'day-1',
          date: '2026-12-02',
          firstMatchStartsAt: genericMatch.startsAt,
          predictionsCloseAt: genericMatch.predictionClosesAt,
          status: options.closed ? 'CLOSED' : 'OPEN',
          isOpenForPredictions: !options.closed,
          predictionsArePublic: Boolean(options.closed),
          matches: [
            {
              ...genericMatch,
              predictionsCloseAt: genericMatch.predictionClosesAt,
              isOpenForPredictions: !options.closed,
              predictionsArePublic: Boolean(options.closed),
              predictions: [],
              rawPayload: null,
            },
          ],
        },
      });
    if (path === '/api/match-days/day-1/predictions' && method === 'PUT')
      return json({
        predictions: [
          {
            id: 'legacy-prediction',
            userId: currentUser.id,
            matchId: genericMatch.id,
            predictedHomeScore: 2,
            predictedAwayScore: 1,
          },
        ],
      });
    if (path === '/api/prediction-board' && method === 'GET') return json(predictionBoard);
    if (path === '/api/prediction-board/simulation' && method === 'PUT')
      return json(predictionBoard);
    if (path === '/api/knockout-bracket' && method === 'PUT')
      return json({
        ...predictionBoard,
        knockout: {
          ...predictionBoard.knockout,
          savedBracket: {
            submittedAt: '2026-07-15T12:30:00.000Z',
            picks: [
              {
                matchNumber: 73,
                homeTeamId: brazil.id,
                awayTeamId: argentina.id,
                advancingTeamId: argentina.id,
                predictedHomeScore: 1,
                predictedAwayScore: 1,
              },
            ],
          },
        },
      });
    if (path === '/api/ranking') return json({ ranking });
    if (path === '/api/ranking/awards') return json({ awards: [] });
    return json(apiError(500), 500);
  });
}

const POOL_SLUG = 'bolao-do-trabalho';
