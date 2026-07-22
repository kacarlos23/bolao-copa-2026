import type { MatchStatus, TieDecisionMethod, TieStatus } from '@prisma/client';

export type ManualTieDecisionMethod = Extract<TieDecisionMethod, 'WALKOVER' | 'ADMINISTRATIVE'>;

export interface TieLegResultInput {
  matchId: string;
  legNumber: number;
  status: MatchStatus;
  homeTeamId: string;
  awayTeamId: string;
  regulationHomeScore: number | null;
  regulationAwayScore: number | null;
  extraTimeHomeScore?: number | null;
  extraTimeAwayScore?: number | null;
  penaltyHomeScore?: number | null;
  penaltyAwayScore?: number | null;
}

export interface TieResultInput {
  teamAId: string;
  teamBId: string;
  expectedLegs: 1 | 2;
  legs: readonly TieLegResultInput[];
  cancelled?: boolean;
  declaredDecision?: {
    method: ManualTieDecisionMethod;
    winnerTeamId: string;
  };
}

export type TieResultReason =
  | 'NO_MATCHES'
  | 'AWAITING_LEGS'
  | 'AWAITING_DECISION'
  | 'DECIDED'
  | 'CANCELLED';

export interface TieResult {
  status: TieStatus;
  decisionMethod: TieDecisionMethod | null;
  winnerTeamId: string | null;
  aggregateTeamAScore: number | null;
  aggregateTeamBScore: number | null;
  completedLegs: number;
  reason: TieResultReason;
}

export class TieResultError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function assertScorePair(
  label: string,
  homeScore: number | null | undefined,
  awayScore: number | null | undefined,
) {
  const bothMissing = homeScore == null && awayScore == null;
  const bothPresent = homeScore != null && awayScore != null;
  if (!bothMissing && !bothPresent) {
    throw new TieResultError('INCOMPLETE_SCORE_PAIR', `${label} precisa dos dois placares.`);
  }
  if (
    bothPresent &&
    (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0)
  ) {
    throw new TieResultError('INVALID_SCORE', `${label} possui placar inválido.`);
  }
}

function scoreForTieTeam(
  leg: TieLegResultInput,
  teamId: string,
  homeScore: number,
  awayScore: number,
) {
  return leg.homeTeamId === teamId ? homeScore : awayScore;
}

function resultWithoutDecision(
  status: TieStatus,
  reason: TieResultReason,
  completedLegs: number,
  aggregateTeamAScore: number | null,
  aggregateTeamBScore: number | null,
): TieResult {
  return {
    status,
    decisionMethod: null,
    winnerTeamId: null,
    aggregateTeamAScore,
    aggregateTeamBScore,
    completedLegs,
    reason,
  };
}

export function computeTieResult(input: TieResultInput): TieResult {
  if (input.teamAId === input.teamBId) {
    throw new TieResultError('DUPLICATE_TEAMS', 'Uma série exige duas equipes distintas.');
  }
  if (input.expectedLegs !== 1 && input.expectedLegs !== 2) {
    throw new TieResultError('INVALID_EXPECTED_LEGS', 'Uma série aceita um ou dois jogos.');
  }
  if (input.cancelled && input.declaredDecision) {
    throw new TieResultError(
      'CANCELLED_WITH_DECISION',
      'Uma série cancelada não pode ter decisão declarada.',
    );
  }
  if (
    input.declaredDecision &&
    !['WALKOVER', 'ADMINISTRATIVE'].includes(input.declaredDecision.method)
  ) {
    throw new TieResultError(
      'INVALID_DECLARED_METHOD',
      'Somente W.O. ou decisão administrativa podem ser declarados.',
    );
  }
  if (
    input.declaredDecision &&
    ![input.teamAId, input.teamBId].includes(input.declaredDecision.winnerTeamId)
  ) {
    throw new TieResultError(
      'INVALID_DECLARED_WINNER',
      'O vencedor declarado deve participar da série.',
    );
  }

  const seenLegNumbers = new Set<number>();
  const orderedLegs = [...input.legs].sort(
    (left, right) => left.legNumber - right.legNumber || left.matchId.localeCompare(right.matchId),
  );
  for (const leg of orderedLegs) {
    if (
      !Number.isInteger(leg.legNumber) ||
      leg.legNumber < 1 ||
      leg.legNumber > input.expectedLegs
    ) {
      throw new TieResultError('INVALID_LEG_NUMBER', 'Número de perna fora da série.');
    }
    if (seenLegNumbers.has(leg.legNumber)) {
      throw new TieResultError('DUPLICATE_LEG', 'A série possui duas partidas na mesma perna.');
    }
    seenLegNumbers.add(leg.legNumber);
    const participants = new Set([leg.homeTeamId, leg.awayTeamId]);
    if (
      participants.size !== 2 ||
      !participants.has(input.teamAId) ||
      !participants.has(input.teamBId)
    ) {
      throw new TieResultError('LEG_TEAM_MISMATCH', 'A partida não pertence às equipes da série.');
    }
    assertScorePair('Tempo regulamentar', leg.regulationHomeScore, leg.regulationAwayScore);
    assertScorePair('Prorrogação', leg.extraTimeHomeScore, leg.extraTimeAwayScore);
    assertScorePair('Pênaltis', leg.penaltyHomeScore, leg.penaltyAwayScore);
    if (
      (leg.extraTimeHomeScore != null || leg.penaltyHomeScore != null) &&
      leg.legNumber !== input.expectedLegs
    ) {
      throw new TieResultError(
        'EARLY_TIE_BREAK',
        'Prorrogação e pênaltis só podem ocorrer na perna decisiva.',
      );
    }
  }

  const completedLegs = orderedLegs.filter(
    (leg) =>
      leg.status === 'FINISHED' &&
      leg.regulationHomeScore != null &&
      leg.regulationAwayScore != null,
  );
  let regulationTeamA = 0;
  let regulationTeamB = 0;
  let aggregateTeamA = 0;
  let aggregateTeamB = 0;
  let hasExtraTime = false;

  for (const leg of completedLegs) {
    const regulationHome = leg.regulationHomeScore!;
    const regulationAway = leg.regulationAwayScore!;
    const extraTimeHome = leg.extraTimeHomeScore ?? 0;
    const extraTimeAway = leg.extraTimeAwayScore ?? 0;
    regulationTeamA += scoreForTieTeam(leg, input.teamAId, regulationHome, regulationAway);
    regulationTeamB += scoreForTieTeam(leg, input.teamBId, regulationHome, regulationAway);
    aggregateTeamA += scoreForTieTeam(
      leg,
      input.teamAId,
      regulationHome + extraTimeHome,
      regulationAway + extraTimeAway,
    );
    aggregateTeamB += scoreForTieTeam(
      leg,
      input.teamBId,
      regulationHome + extraTimeHome,
      regulationAway + extraTimeAway,
    );
    hasExtraTime ||= leg.extraTimeHomeScore != null;
  }

  const aggregateA = completedLegs.length ? aggregateTeamA : null;
  const aggregateB = completedLegs.length ? aggregateTeamB : null;

  if (input.cancelled) {
    return resultWithoutDecision(
      'CANCELLED',
      'CANCELLED',
      completedLegs.length,
      aggregateA,
      aggregateB,
    );
  }
  if (input.declaredDecision) {
    return {
      status: 'DECIDED',
      decisionMethod: input.declaredDecision.method,
      winnerTeamId: input.declaredDecision.winnerTeamId,
      aggregateTeamAScore: aggregateA,
      aggregateTeamBScore: aggregateB,
      completedLegs: completedLegs.length,
      reason: 'DECIDED',
    };
  }

  if (completedLegs.length !== input.expectedLegs) {
    const hasStarted = orderedLegs.some((leg) => leg.status === 'LIVE') || completedLegs.length > 0;
    return resultWithoutDecision(
      hasStarted ? 'IN_PROGRESS' : 'SCHEDULED',
      orderedLegs.length ? 'AWAITING_LEGS' : 'NO_MATCHES',
      completedLegs.length,
      aggregateA,
      aggregateB,
    );
  }

  if (hasExtraTime && regulationTeamA !== regulationTeamB) {
    throw new TieResultError(
      'UNNECESSARY_EXTRA_TIME',
      'Prorrogação registrada sem empate no agregado regulamentar.',
    );
  }

  if (aggregateTeamA !== aggregateTeamB) {
    return {
      status: 'DECIDED',
      decisionMethod: hasExtraTime ? 'EXTRA_TIME' : 'AGGREGATE',
      winnerTeamId: aggregateTeamA > aggregateTeamB ? input.teamAId : input.teamBId,
      aggregateTeamAScore: aggregateTeamA,
      aggregateTeamBScore: aggregateTeamB,
      completedLegs: completedLegs.length,
      reason: 'DECIDED',
    };
  }

  const decidingLeg = completedLegs.find((leg) => leg.legNumber === input.expectedLegs);
  const penaltyHome = decidingLeg?.penaltyHomeScore;
  const penaltyAway = decidingLeg?.penaltyAwayScore;
  if (decidingLeg && penaltyHome != null && penaltyAway != null && penaltyHome !== penaltyAway) {
    return {
      status: 'DECIDED',
      decisionMethod: 'PENALTIES',
      winnerTeamId: penaltyHome > penaltyAway ? decidingLeg.homeTeamId : decidingLeg.awayTeamId,
      aggregateTeamAScore: aggregateTeamA,
      aggregateTeamBScore: aggregateTeamB,
      completedLegs: completedLegs.length,
      reason: 'DECIDED',
    };
  }

  return resultWithoutDecision(
    'IN_PROGRESS',
    'AWAITING_DECISION',
    completedLegs.length,
    aggregateTeamA,
    aggregateTeamB,
  );
}
