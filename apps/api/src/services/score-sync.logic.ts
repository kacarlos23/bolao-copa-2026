import { MatchStatus } from '@prisma/client';

export function shouldIgnoreScoreRegression(
  currentStatus: MatchStatus,
  incomingStatus: MatchStatus,
) {
  return currentStatus === MatchStatus.FINISHED && incomingStatus !== MatchStatus.FINISHED;
}

export function statusAllowedByKickoff(
  incomingStatus: MatchStatus,
  startsAt: Date,
  now = new Date(),
) {
  if (
    now < startsAt &&
    (incomingStatus === MatchStatus.LIVE || incomingStatus === MatchStatus.FINISHED)
  ) {
    return MatchStatus.SCHEDULED;
  }

  return incomingStatus;
}
