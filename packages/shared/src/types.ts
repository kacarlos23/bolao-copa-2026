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

export type ScoringCriterion =
  | 'EXACT_SCORE'
  | 'CORRECT_OUTCOME'
  | 'ONE_TEAM_GOALS'
  | 'MISS';

export interface ScoringRuleValues {
  exactScore: number;
  correctOutcome: number;
  oneTeamGoals: number;
  miss: number;
}

export interface ScoringRuleSetInput {
  id: string;
  key: string;
  name: string;
  version: number;
  rules: ScoringRuleValues;
}

export interface ScoreBreakdown {
  criterion: ScoringCriterion;
  awardedPoints: number;
  exactScore: boolean;
  outcomeMatched: boolean;
  homeGoalsMatched: boolean;
  awayGoalsMatched: boolean;
  rule: ScoringRuleValues;
}

export interface ScoreResult {
  points: number;
  scoreType: ScoreType;
  breakdown: ScoreBreakdown;
}

export type TieBreakerField =
  | 'points'
  | 'exactScores'
  | 'resultHits'
  | 'oneGoalHits'
  | 'misses';

export interface TieBreakerCriterion {
  field: TieBreakerField;
  direction: 'asc' | 'desc';
  label: string;
}
