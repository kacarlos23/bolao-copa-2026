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
      ? Object.values(fieldErrors).flat().find((value) => typeof value === 'string')
      : undefined;
    throw new Error(
      body?.error?.message ?? firstFieldError ?? 'Nao foi possivel concluir a operacao.',
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
  topScorers: CupTopScorer[];
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
  matchDays: () => request<{ matchDays: MatchDay[] }>('/api/match-days'),
  matchDay: (id: string) => request<{ matchDay: MatchDay }>(`/api/match-days/${id}`),
  savePredictions: (
    id: string,
    predictions: Array<{ matchId: string; predictedHomeScore: number; predictedAwayScore: number }>,
  ) =>
    request<{ predictions: Prediction[] }>(`/api/match-days/${id}/predictions`, {
      method: 'PUT',
      body: JSON.stringify({ predictions }),
    }),
  ranking: () => request<{ ranking: RankingRow[] }>('/api/ranking'),
  cupOverview: () => request<CupOverview>('/api/cup/overview'),
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
    request<{ teams: number; matches: number }>('/api/admin/seed-worldcup-2026', { method: 'POST' }),
  createAdminMatch: (input: { homeTeamCode: string; awayTeamCode: string; startsAt: string }) =>
    request<{ match: Match }>('/api/admin/matches', {
      method: 'POST',
      body: JSON.stringify(input),
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
