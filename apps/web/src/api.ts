import {
  competitionSeasonsResponseSchema,
  competitionsResponseSchema,
  matchesResponseSchema,
  predictionsResponseSchema,
  publicMatchPredictionsResponseSchema,
  rankingResponseSchema,
  roundsResponseSchema,
  savedPredictionsResponseSchema,
  seasonTeamsResponseSchema,
  standingsResponseSchema,
  teamProfileResponseSchema,
  type CompetitionDto,
  type MatchDto,
  type PublicMatchPredictionsResponse,
  type RoundDto,
  type SeasonDto,
  type StandingRowDto,
  type TeamProfileDto,
  type SeasonTeamSummaryDto,
} from '@bolao/shared';
import { request } from './services/api-client';
import { createRealtimeClient } from './services/realtime';
import type { ConnectionStatus } from './services/realtime';

export { API_URL, ApiError, errorMessage, LatestRequest } from './services/api-client';

export interface User {
  id: string;
  username: string;
  nickname: string;
  avatarUrl?: string | null;
  role: 'USER' | 'ADMIN';
  status?: 'ACTIVE' | 'BLOCKED';
  createdAt?: string;
  updatedAt?: string;
}
export interface PoolSeasonRules {
  scoring: {
    id: string;
    key: string;
    name: string;
    version: number;
    rules: { exactScore: number; correctOutcome: number; oneTeamGoals: number; miss: number };
  };
  tieBreakers: {
    id: string;
    key: string;
    name: string;
    version: number;
    allowSharedPositions: boolean;
    criteria: Array<{ field: string; direction: 'asc' | 'desc'; label: string }>;
  };
  predictionPolicy: {
    scoreableFrom: string | null;
    scoreableFromRound: number | null;
    startsAtRound: number | null;
    historicalMatchesScoreable: boolean;
  };
}

export interface EngagementDashboard {
  achievements: Array<{
    id: string;
    progress: unknown;
    isProvisional: boolean;
    achievedAt?: string | null;
    revokedAt?: string | null;
    definition: { key: string; version: number; name: string; description: string; rarity: string };
  }>;
  streaks: Array<{ type: string; currentCount: number; bestCount: number }>;
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    isProvisional: boolean;
    readAt?: string | null;
    createdAt: string;
  }>;
  preferences: NotificationPreferences;
}

export interface SeasonSyncStatus {
  status: 'SUCCESS' | 'PARTIAL' | 'DRY_RUN' | 'FAILED' | 'NEVER';
  lastSyncedAt: string | null;
  changedMatches: number;
}

export interface SeasonSyncResponse {
  status: 'UPDATED' | 'UNCHANGED';
  changedMatches: number;
  updatedProfiles?: number;
  lastSyncedAt: string;
  runs: Array<{
    runId: string;
    type: 'TEAMS' | 'SCHEDULE' | 'RESULTS' | 'STANDINGS';
    status: 'SUCCESS' | 'PARTIAL' | 'DRY_RUN';
    counts: {
      fetched: number;
      inserted: number;
      updated: number;
      unchanged: number;
      quarantined: number;
    };
    reused: boolean;
    startedAt: string;
    finishedAt: string;
  }>;
}

export interface NotificationPreferences {
  inAppEnabled: boolean;
  pushEnabled: boolean;
  emailEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  timezone: string;
}

export interface SeasonMatchesQuery {
  roundId?: string;
  status?: MatchDto['status'];
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export interface Team {
  id: string;
  name: string;
  code?: string | null;
  flagUrl?: string | null;
  crestUrl?: string | null;
  metadata?: {
    flagEmoji?: string;
    group?: string;
    iso2?: string;
  } | null;
}

export interface Prediction {
  id: string;
  userId: string;
  matchId: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  user?: { id: string; nickname: string; avatarUrl?: string | null };
}

export interface Match {
  id: string;
  startsAt: string;
  status: string;
  predictionsCloseAt?: string;
  isOpenForPredictions?: boolean;
  predictionsArePublic?: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
  homeTeam: Team;
  awayTeam: Team;
  predictions: Prediction[];
  rawPayload?: {
    group?: string;
    round?: string;
    type?: string;
    knockoutFixtureId?: string;
    knockoutMatchNumber?: number;
    knockoutStage?: KnockoutStage;
  } | null;
}

export interface MatchDay {
  id: string;
  date: string;
  firstMatchStartsAt: string;
  predictionsCloseAt: string;
  status: string;
  isOpenForPredictions?: boolean;
  predictionsArePublic?: boolean;
  matches: Match[];
}

export interface RankingRow {
  rank: number;
  userId: string;
  nickname: string;
  avatarUrl?: string | null;
  points: number;
  finalPoints: number;
  played: number;
  exactScores: number;
  resultHits: number;
  oneGoalHits: number;
  misses: number;
  lastFive: number[];
  lastFiveMatches?: Array<{
    score: number;
    match?: {
      homeTeam: Team;
      awayTeam: Team;
      homeScore?: number | null;
      awayScore?: number | null;
      finalHomeScore?: number | null;
      finalAwayScore?: number | null;
      status: string;
    };
  }>;
  hasLiveData: boolean;
  movement?: {
    delta: number;
    fromRank: number;
    toRank: number;
    isProvisional: boolean;
    changedAt: string;
  } | null;
}

export interface RankingAward {
  key: string;
  title: string;
  subtitle: string;
  scope: 'GROUP_ROUND' | 'GROUP_STAGE' | 'KNOCKOUT_BRACKET' | 'KNOCKOUT_STAGE' | 'OVERALL';
  tier: 'standard' | 'major' | 'legendary';
  status: 'pending' | 'live' | 'locked' | 'empty';
  icon: string;
  winner?: {
    userId: string;
    nickname: string;
    avatarUrl?: string | null;
    points: number;
    exactScores: number;
    resultHits: number;
    oneGoalHits: number;
    misses: number;
  };
}

export type RankingPeriod = 'all' | 'week' | 'day';

export type GenericSeason = SeasonDto;
export type GenericRound = RoundDto;
export type GenericMatch = MatchDto;
export type LeagueStandingRow = StandingRowDto;
export type GenericCompetition = CompetitionDto;
export type LeagueTeamSummary = SeasonTeamSummaryDto;
export type LeagueTeamProfile = TeamProfileDto;

export interface RankingRefreshResponse {
  ranking: RankingRow[];
  sync: {
    startedAt: string;
    finishedAt: string;
    scraped: number;
    topScorers: number | null;
    changedEntries: number;
    updatedMatches: number;
    updatedKnockoutFixtures: number;
  };
}

export interface CupStandingRow {
  rank: number;
  group: string;
  team: Team;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  lastFive: Array<'W' | 'D' | 'L'>;
}

export interface CupStandingGroup {
  group: string;
  rows: CupStandingRow[];
}

export interface CupMatchResult {
  id: string;
  startsAt: string;
  status: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore?: number | null;
  awayScore?: number | null;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
  round?: string | null;
  group?: string | null;
}

export interface CupTopScorer {
  rank: number;
  playerName: string;
  teamName: string;
  position?: string | null;
  imageUrl?: string | null;
  teamFlagUrl?: string | null;
  goals: number;
}

export interface CupOverview {
  checkedAt: string;
  standingsByGroup: CupStandingGroup[];
  matches: CupMatchResult[];
  knockoutFixtures: KnockoutFixture[];
  topScorers: CupTopScorer[];
}

export interface PredictionBoardStanding {
  rank: number;
  team: Team;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface PredictionBoardMatch {
  id: string;
  matchDayId: string;
  startsAt: string;
  status: string;
  predictionsCloseAt: string;
  isOpenForPredictions: boolean;
  predictionsArePublic: boolean;
  homeScore?: number | null;
  awayScore?: number | null;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
  homeTeam: Team;
  awayTeam: Team;
  round?: string | null;
  ownPrediction?: Prediction | null;
  simulationScore?: {
    matchId: string;
    predictedHomeScore: number;
    predictedAwayScore: number;
  } | null;
  publicPredictions: Prediction[];
}

export interface PredictionBoardGroup {
  group: string;
  standings: PredictionBoardStanding[];
  matches: PredictionBoardMatch[];
}

export type KnockoutStage =
  | 'ROUND_OF_32'
  | 'ROUND_OF_16'
  | 'QUARTER_FINAL'
  | 'SEMI_FINAL'
  | 'THIRD_PLACE'
  | 'FINAL';

export interface KnockoutFixture {
  id: string;
  matchNumber: number;
  stage: KnockoutStage;
  startsAt: string;
  homeSource: string;
  awaySource: string;
  status: string;
  homeScore?: number | null;
  awayScore?: number | null;
  finalHomeScore?: number | null;
  finalAwayScore?: number | null;
  homeTeam?: Team | null;
  awayTeam?: Team | null;
  winnerTeam?: Team | null;
}

export interface KnockoutPick {
  matchNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  advancingTeamId: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
}

export interface PredictionBoard {
  checkedAt: string;
  predictionCloseMinutes: number;
  canPredict: boolean;
  groupStageComplete: boolean;
  groups: PredictionBoardGroup[];
  knockout: {
    generation: {
      id: string;
      sequence: number;
      mode: 'PROVISIONAL' | 'OFFICIAL';
      status: 'ACTIVE' | 'LOCKED' | 'RESET';
      closesAt?: string | null;
      isOpen: boolean;
    };
    fixtures: KnockoutFixture[];
    roundOf32: Array<{
      matchNumber: number;
      homeTeamId: string | null;
      awayTeamId: string | null;
    }>;
    resolvedGroups: string[];
    savedBracket?: { submittedAt: string; picks: KnockoutPick[] } | null;
  };
}

export interface AdminPredictionSettings {
  predictionCloseMinutes: number;
  previousCloseMinutes?: number;
  reopenedMatches?: number;
  closedMatches?: number;
  updatedAt?: string | null;
}

export interface AdminScoreSyncSettings {
  enabled: boolean;
  previousEnabled?: boolean;
  updatedAt?: string | null;
}

export interface CompetitionFeatureFlags {
  readEnabled: boolean;
  writeEnabled: boolean;
  uiEnabled: boolean;
  syncEnabled: boolean;
  reason: string;
  updatedAt: string;
  updatedById: string | null;
}

export interface PublicKnockoutBracket {
  id: string;
  submittedAt: string;
  user: { id: string; nickname: string; avatarUrl?: string | null };
  picks: Array<{
    id: string;
    predictedHomeScore: number;
    predictedAwayScore: number;
    fixture: KnockoutFixture;
    homeTeam: Team;
    awayTeam: Team;
    advancingTeam: Team;
  }>;
}

export interface PublicKnockoutBracketsResponse {
  generation: PredictionBoard['knockout']['generation'];
  brackets: PublicKnockoutBracket[];
}

export const api = {
  me: () => request<{ user: User }>('/api/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, nickname: string, password: string) =>
    request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, nickname, password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  uploadAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return request<{ user: User }>('/api/auth/me/avatar', {
      method: 'POST',
      body: formData,
    });
  },
  resetAvatar: () => request<{ user: User }>('/api/auth/me/avatar', { method: 'DELETE' }),
  prepareBrasileirao2026: () =>
    request<{ seasonId: string; startsAtRound: number; evidence: unknown }>(
      '/api/admin/brasileirao-2026/prepare',
      { method: 'POST', body: '{}' },
    ),
  competitionFeatures: (seasonId: string) =>
    request<{ flags: CompetitionFeatureFlags }>(`/api/admin/seasons/${seasonId}/features`),
  updateCompetitionFeatures: (
    seasonId: string,
    input: Pick<
      CompetitionFeatureFlags,
      'readEnabled' | 'writeEnabled' | 'uiEnabled' | 'syncEnabled' | 'reason'
    >,
  ) =>
    request<{ flags: CompetitionFeatureFlags }>(`/api/admin/seasons/${seasonId}/features`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  matchDays: () =>
    request<{ matchDays: MatchDay[]; predictionCloseMinutes: number }>('/api/match-days'),
  matchDay: (id: string) =>
    request<{ matchDay: MatchDay; predictionCloseMinutes: number }>(`/api/match-days/${id}`),
  savePredictions: (
    id: string,
    predictions: Array<{ matchId: string; predictedHomeScore: number; predictedAwayScore: number }>,
  ) =>
    request<{ predictions: Prediction[] }>(`/api/match-days/${id}/predictions`, {
      method: 'PUT',
      body: JSON.stringify({ predictions }),
    }),
  ranking: (period: RankingPeriod = 'all') =>
    request<{ ranking: RankingRow[] }>(`/api/ranking?period=${period}`),
  rankingAwards: () => request<{ awards: RankingAward[] }>('/api/ranking/awards'),
  competitions: (signal?: AbortSignal) =>
    request('/api/competitions?page=1&pageSize=100', {
      signal,
      schema: competitionsResponseSchema,
    }),
  competitionSeasons: (competitionSlug: string, signal?: AbortSignal) =>
    request(
      `/api/competitions/${encodeURIComponent(competitionSlug)}/seasons?page=1&pageSize=100`,
      {
        signal,
        schema: competitionSeasonsResponseSchema,
      },
    ),
  seasonRounds: (seasonId: string) =>
    request(`/api/seasons/${seasonId}/rounds?page=1&pageSize=100`, {
      schema: roundsResponseSchema,
    }),
  seasonUiFeature: (seasonId: string, signal?: AbortSignal) =>
    request<{ uiEnabled: boolean }>(`/api/seasons/${seasonId}/features`, { signal }),
  seasonMatches: (seasonId: string, query: string | SeasonMatchesQuery) => {
    const options = typeof query === 'string' ? { roundId: query } : query;
    const params = new URLSearchParams({
      page: String(options.page ?? 1),
      pageSize: String(options.pageSize ?? 100),
    });
    if (options.roundId) params.set('roundId', options.roundId);
    if (options.status) params.set('status', options.status);
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    return request(`/api/seasons/${seasonId}/matches?${params.toString()}`, {
      schema: matchesResponseSchema,
      signal: options.signal,
    });
  },
  seasonStandings: (seasonId: string) =>
    request(`/api/seasons/${seasonId}/standings?page=1&pageSize=100`, {
      schema: standingsResponseSchema,
    }),
  seasonTeams: (seasonId: string, signal?: AbortSignal) =>
    request(`/api/seasons/${seasonId}/teams?page=1&pageSize=100`, {
      schema: seasonTeamsResponseSchema,
      signal,
    }),
  seasonTeamProfile: (seasonId: string, teamId: string, signal?: AbortSignal) =>
    request(
      `/api/seasons/${encodeURIComponent(seasonId)}/teams/${encodeURIComponent(teamId)}/profile`,
      { schema: teamProfileResponseSchema, signal },
    ),
  seasonPredictions: (poolSlug: string, seasonId: string, matchDayId?: string) =>
    request(
      `/api/pools/${poolSlug}/seasons/${seasonId}/predictions?page=1&pageSize=100${
        matchDayId ? `&matchDayId=${encodeURIComponent(matchDayId)}` : ''
      }`,
      { schema: predictionsResponseSchema },
    ),
  seasonPublicMatchPredictions: (poolSlug: string, seasonId: string, matchId: string) =>
    request<PublicMatchPredictionsResponse>(
      `/api/pools/${encodeURIComponent(poolSlug)}/seasons/${encodeURIComponent(seasonId)}/matches/${encodeURIComponent(matchId)}/predictions`,
      { schema: publicMatchPredictionsResponseSchema },
    ),
  saveSeasonPredictions: (
    poolSlug: string,
    seasonId: string,
    matchDayId: string,
    predictions: Array<{
      matchId: string;
      predictedHomeScore: number;
      predictedAwayScore: number;
    }>,
  ) =>
    request(`/api/pools/${poolSlug}/seasons/${seasonId}/predictions`, {
      method: 'PUT',
      body: JSON.stringify({ matchDayId, predictions }),
      schema: savedPredictionsResponseSchema,
      idempotencyKey: `${seasonId}:${matchDayId}:${predictions
        .map((item) => `${item.matchId}-${item.predictedHomeScore}-${item.predictedAwayScore}`)
        .join('|')}`,
    }),
  seasonRanking: (poolSlug: string, seasonId: string, query: string = 'scope=overall') =>
    request(`/api/pools/${poolSlug}/seasons/${seasonId}/ranking?page=1&pageSize=100&${query}`, {
      schema: rankingResponseSchema,
    }),
  seasonRules: (poolSlug: string, seasonId: string) =>
    request<PoolSeasonRules>(`/api/pools/${poolSlug}/seasons/${seasonId}/rules`),
  seasonEngagement: (poolSlug: string, seasonId: string) =>
    request<EngagementDashboard>(`/api/pools/${poolSlug}/seasons/${seasonId}/engagement`),
  seasonAwards: (poolSlug: string, seasonId: string) =>
    request<{ awards: RankingAward[] }>(`/api/pools/${poolSlug}/seasons/${seasonId}/awards`),
  seasonSyncStatus: (poolSlug: string, seasonId: string) =>
    request<SeasonSyncStatus>(`/api/pools/${poolSlug}/seasons/${seasonId}/sync-status`),
  syncSeasonResults: (poolSlug: string, seasonId: string) =>
    request<SeasonSyncResponse>(`/api/pools/${poolSlug}/seasons/${seasonId}/sync-results`, {
      method: 'POST',
      body: '{}',
      timeoutMs: 75_000,
      idempotencyKey:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${seasonId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
  adminRefreshCompetitionData: (seasonId: string, justification: string, includeProfiles = true) =>
    request<SeasonSyncResponse>(`/api/admin/seasons/${seasonId}/refresh-competition-data`, {
      method: 'POST',
      body: JSON.stringify({ justification, includeProfiles }),
      timeoutMs: 150_000,
      idempotencyKey:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `admin-refresh-${seasonId}-${Date.now()}`,
    }),
  adminSetLiveMatchResult: (
    seasonId: string,
    matchId: string,
    input: {
      status: 'LIVE' | 'FINISHED';
      homeScore: number;
      awayScore: number;
      justification: string;
    },
  ) =>
    request(`/api/admin/seasons/${seasonId}/matches/${matchId}/live-result`, {
      method: 'PUT',
      body: JSON.stringify(input),
      idempotencyKey:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `admin-live-result-${matchId}-${Date.now()}`,
    }),
  recordRankingVisit: (poolSlug: string, seasonId: string) =>
    request<{
      summary: {
        fromRank: number;
        toRank: number;
        delta: number;
        provisional: boolean;
        since: string;
      } | null;
    }>(`/api/pools/${poolSlug}/seasons/${seasonId}/ranking/visit`, { method: 'POST', body: '{}' }),
  markNotificationRead: (poolSlug: string, seasonId: string, notificationId: string) =>
    request<void>(
      `/api/pools/${poolSlug}/seasons/${seasonId}/notifications/${notificationId}/read`,
      { method: 'POST', body: '{}' },
    ),
  updateNotificationPreferences: (
    poolSlug: string,
    seasonId: string,
    preferences: NotificationPreferences,
  ) =>
    request<{ preferences: NotificationPreferences }>(
      `/api/pools/${poolSlug}/seasons/${seasonId}/notifications/preferences`,
      { method: 'PATCH', body: JSON.stringify(preferences) },
    ),
  refreshRanking: (period: RankingPeriod = 'all') =>
    request<RankingRefreshResponse>(`/api/ranking/refresh?period=${period}`, {
      method: 'POST',
    }),
  cupOverview: () => request<CupOverview>('/api/cup/overview'),
  predictionBoard: () => request<PredictionBoard>('/api/prediction-board'),
  previewPredictionBoard: (
    groupScores: Array<{
      matchId: string;
      predictedHomeScore: number;
      predictedAwayScore: number;
    }>,
  ) =>
    request<PredictionBoard>('/api/prediction-board/preview', {
      method: 'POST',
      body: JSON.stringify({ groupScores }),
    }),
  savePredictionBoardSimulation: (
    groupScores: Array<{
      matchId: string;
      predictedHomeScore: number;
      predictedAwayScore: number;
    }>,
  ) =>
    request<PredictionBoard>('/api/prediction-board/simulation', {
      method: 'PUT',
      body: JSON.stringify({ groupScores }),
    }),
  saveKnockoutBracket: (
    picks: Array<{
      matchNumber: number;
      predictedHomeScore: number;
      predictedAwayScore: number;
      advancingTeamId: string;
    }>,
    groupScores?: Array<{
      matchId: string;
      predictedHomeScore: number;
      predictedAwayScore: number;
    }>,
  ) =>
    request<PredictionBoard>('/api/knockout-bracket', {
      method: 'PUT',
      body: JSON.stringify({ picks, groupScores }),
    }),
  publicKnockoutBrackets: () =>
    request<PublicKnockoutBracketsResponse>('/api/knockout-bracket/public'),
  adminUsers: () => request<{ users: User[] }>('/api/admin/users'),
  setAdminUserStatus: (id: string, blocked: boolean) =>
    request<{ user: User }>(`/api/admin/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ blocked }),
    }),
  resetAdminUserPassword: (id: string, password: string) =>
    request<void>(`/api/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  adminTeams: () => request<{ teams: Team[] }>('/api/admin/teams'),
  seedWorldCup2026: () =>
    request<{ teams: number; matches: number }>('/api/admin/seed-worldcup-2026', {
      method: 'POST',
    }),
  createAdminMatch: (input: { homeTeamCode: string; awayTeamCode: string; startsAt: string }) =>
    request<{ match: Match }>('/api/admin/matches', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  adminPredictionSettings: () =>
    request<AdminPredictionSettings>('/api/admin/settings/predictions'),
  updateAdminPredictionSettings: (predictionCloseMinutes: number) =>
    request<AdminPredictionSettings>('/api/admin/settings/predictions', {
      method: 'PATCH',
      body: JSON.stringify({ predictionCloseMinutes }),
    }),
  adminScoreSyncSettings: () => request<AdminScoreSyncSettings>('/api/admin/settings/score-sync'),
  updateAdminScoreSyncSettings: (enabled: boolean) =>
    request<AdminScoreSyncSettings>('/api/admin/settings/score-sync', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
};

export function createRankingEvents(onRanking: (ranking: RankingRow[]) => void) {
  return createRealtimeClient({
    eventTypes: ['ranking.updated'],
    onEvent: (event) => {
      const ranking = event.payload.ranking;
      onRanking(Array.isArray(ranking) ? (ranking as RankingRow[]) : []);
    },
  });
}

export function createPredictionBoardEvents(
  onUpdate: () => void,
  onStatus?: (status: ConnectionStatus) => void,
) {
  return createRealtimeClient({
    eventTypes: [
      'prediction-board.updated',
      'prediction-settings.updated',
      'knockout.updated',
      'prediction.updated',
    ],
    onEvent: onUpdate,
    onStatus,
  });
}
