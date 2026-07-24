export interface PoolScoreabilityPolicy {
  scoreableFromRound: number | null;
  scoreableFrom: Date | null;
  startsAtRound: number | null;
  historicalMatchesScoreable: boolean;
}

export interface ScoreableMatch {
  startsAt: Date;
  roundOrder: number | null;
}

export function isPoolMatchScoreable(
  policy: PoolScoreabilityPolicy | null | undefined,
  match: ScoreableMatch,
) {
  if (!policy || policy.historicalMatchesScoreable) return true;

  const gateRound = Math.max(policy.startsAtRound ?? 0, policy.scoreableFromRound ?? 0);
  if (gateRound > 0) {
    return match.roundOrder != null && match.roundOrder >= gateRound;
  }
  if (policy.scoreableFrom) return match.startsAt >= policy.scoreableFrom;
  return true;
}
