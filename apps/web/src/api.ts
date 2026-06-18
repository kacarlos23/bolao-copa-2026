export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: isFormData
      ? options.headers
      : {
          'content-type': 'application/json',
          ...(options.headers ?? {}),
        },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const fieldErrors = body?.error?.issues?.fieldErrors;
    const firstFieldError = fieldErrors
      ? Object.values(fieldErrors)
          .flat()
          .find((value) => typeof value === 'string')
      : undefined;
    throw new Error(
      body?.error?.message ?? firstFieldError ?? 'Não foi possível concluir a operação.',
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

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

export interface Team {
  id: string;
  name: string;
  code?: string | null;
  flagUrl?: string | null;
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
  hasLiveData: boolean;
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
};

export function createRankingEvents(onRanking: (ranking: RankingRow[]) => void) {
  const source = new EventSource(`${API_URL}/api/events`, { withCredentials: true });
  source.addEventListener('ranking.updated', (event) => {
    const data = JSON.parse((event as MessageEvent).data);
    onRanking(data.ranking);
  });
  return source;
}

export function createPredictionBoardEvents(onUpdate: () => void) {
  const source = new EventSource(`${API_URL}/api/events`, { withCredentials: true });
  source.addEventListener('prediction-board.updated', onUpdate);
  source.addEventListener('prediction-settings.updated', onUpdate);
  source.addEventListener('knockout.updated', onUpdate);
  return source;
}
