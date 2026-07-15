import { stableHash } from './scoring-rules.service.js';

export interface ScoreState {
  poolSeasonId: string;
  targetId: string;
  calculationKey: string;
  points: number;
  scoringVersion: number;
}

export function planScoreTransition(
  before: ScoreState | null,
  after: ScoreState | null,
  sourceRevision: string,
) {
  if (before?.calculationKey === after?.calculationKey) return { changed: false as const };
  const idempotencyKey = stableHash({
    poolSeasonId: after?.poolSeasonId ?? before?.poolSeasonId,
    targetId: after?.targetId ?? before?.targetId,
    sourceRevision,
    before: before?.calculationKey ?? null,
    after: after?.calculationKey ?? null,
  });
  return { changed: true as const, idempotencyKey, before, after };
}
