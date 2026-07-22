import type { Prisma, TieDecisionMethod } from '@prisma/client';
import { AppError } from '../../http/errors.js';
import { serializableTransaction } from '../../prisma-transaction.js';
import { computeTieResult, type ManualTieDecisionMethod } from './tie-result.js';

function isManualDecision(method: TieDecisionMethod | null): method is ManualTieDecisionMethod {
  return method === 'WALKOVER' || method === 'ADMINISTRATIVE';
}

export async function recomputeTie(tieId: string, recomputedAt = new Date()) {
  return serializableTransaction(async (tx) => recomputeTieInTransaction(tx, tieId, recomputedAt));
}

export async function recomputeTieInTransaction(
  tx: Prisma.TransactionClient,
  tieId: string,
  recomputedAt = new Date(),
) {
  const tie = await tx.tie.findUnique({
    where: { id: tieId },
    include: { matches: { orderBy: { legNumber: 'asc' } } },
  });
  if (!tie) throw new AppError(404, 'Série eliminatória não encontrada.', 'TIE_NOT_FOUND');

  const result = computeTieResult({
    teamAId: tie.teamAId,
    teamBId: tie.teamBId,
    expectedLegs: tie.expectedLegs as 1 | 2,
    cancelled: tie.status === 'CANCELLED',
    declaredDecision:
      isManualDecision(tie.decisionMethod) && tie.winnerTeamId
        ? { method: tie.decisionMethod, winnerTeamId: tie.winnerTeamId }
        : undefined,
    legs: tie.matches.map((match) => ({
      matchId: match.id,
      legNumber: match.legNumber!,
      status: match.status,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      regulationHomeScore: match.regulationHomeScore,
      regulationAwayScore: match.regulationAwayScore,
      extraTimeHomeScore: match.extraTimeHomeScore,
      extraTimeAwayScore: match.extraTimeAwayScore,
      penaltyHomeScore: match.penaltyHomeScore,
      penaltyAwayScore: match.penaltyAwayScore,
    })),
  });

  const decisionChanged =
    tie.status !== result.status ||
    tie.winnerTeamId !== result.winnerTeamId ||
    tie.decisionMethod !== result.decisionMethod;
  return tx.tie.update({
    where: { id: tie.id },
    data: {
      status: result.status,
      decisionMethod: result.decisionMethod,
      winnerTeamId: result.winnerTeamId,
      aggregateTeamAScore: result.aggregateTeamAScore,
      aggregateTeamBScore: result.aggregateTeamBScore,
      decidedAt:
        result.status === 'DECIDED'
          ? decisionChanged
            ? recomputedAt
            : (tie.decidedAt ?? recomputedAt)
          : null,
      lastRecomputedAt: recomputedAt,
    },
  });
}
