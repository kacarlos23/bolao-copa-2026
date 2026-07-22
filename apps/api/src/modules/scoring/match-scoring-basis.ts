import type { MatchStatus } from '@prisma/client';

export interface MatchScoringSource {
  tieId: string | null;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  finalHomeScore: number | null;
  finalAwayScore: number | null;
  regulationHomeScore: number | null;
  regulationAwayScore: number | null;
}

export function matchScoreForPrediction(
  match: MatchScoringSource,
  options: { fallbackToLiveScoreWhenFinalMissing?: boolean } = {},
) {
  if (match.tieId) {
    return {
      homeScore: match.regulationHomeScore,
      awayScore: match.regulationAwayScore,
      basis: 'REGULATION' as const,
    };
  }
  const useFinal = match.status === 'FINISHED';
  return {
    homeScore: useFinal
      ? (match.finalHomeScore ??
        (options.fallbackToLiveScoreWhenFinalMissing ? match.homeScore : null))
      : match.homeScore,
    awayScore: useFinal
      ? (match.finalAwayScore ??
        (options.fallbackToLiveScoreWhenFinalMissing ? match.awayScore : null))
      : match.awayScore,
    basis: useFinal ? ('LEGACY_FINAL' as const) : ('LEGACY_LIVE' as const),
  };
}
