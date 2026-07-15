export interface KnockoutDraftValue {
  home: string;
  away: string;
  advancingTeamId: string | null;
}

export interface KnockoutParticipants {
  homeTeamId: string | null;
  awayTeamId: string | null;
}

export function resolvedAdvancingTeam(
  value: KnockoutDraftValue | undefined,
  participants?: KnockoutParticipants,
) {
  if (
    !value ||
    !participants?.homeTeamId ||
    !participants.awayTeamId ||
    value.home === '' ||
    value.away === ''
  ) {
    return null;
  }
  if (value.home !== value.away) {
    return Number(value.home) > Number(value.away)
      ? participants.homeTeamId
      : participants.awayTeamId;
  }
  return value.advancingTeamId &&
    [participants.homeTeamId, participants.awayTeamId].includes(value.advancingTeamId)
    ? value.advancingTeamId
    : null;
}
