export const USERNAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}' -]{1,78}[\p{L}\p{M}]$/u;

export type UserRole = 'USER' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'BLOCKED';
export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
export type MatchDayStatus = 'OPEN' | 'CLOSED' | 'IN_PROGRESS' | 'FINISHED';
export type ScoreType = 'EXACT_SCORE' | 'RESULT' | 'ONE_TEAM_GOALS' | 'MISS';

export interface ScoreInput {
  predictedHomeScore: number;
  predictedAwayScore: number;
  actualHomeScore: number;
  actualAwayScore: number;
}

export interface ScoreResult {
  points: number;
  scoreType: ScoreType;
}
