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

  // Once a pool has an explicit temporal cutoff, the date of the fixture is
  // the source of truth. A postponed match may keep its original round while
  // being played after the pool opened, so combining both gates would reject
  // a legitimate prediction forever.
  if (policy.scoreableFrom) return match.startsAt >= policy.scoreableFrom;

  const gateRound = Math.max(policy.startsAtRound ?? 0, policy.scoreableFromRound ?? 0);
  if (gateRound > 0 && (match.roundOrder == null || match.roundOrder < gateRound)) return false;
  return true;
}
