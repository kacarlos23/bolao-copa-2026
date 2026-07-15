import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  INITIAL_SCORING_RULE_SET,
  INITIAL_TIE_BREAKERS,
  type ScoringRuleSetInput,
  type TieBreakerCriterion,
} from '@bolao/shared';
import { prisma } from '../../prisma.js';

export const INITIAL_SCORING_VERSION_ID = 'scoring-rule-set-version-15-3-1-0-v1';
export const INITIAL_TIE_BREAKER_ID = 'tie-breaker-classic-v1';

type RuleDatabase = Pick<Prisma.TransactionClient, 'poolSeason' | 'scoringRuleSetVersion' | 'tieBreakerRuleSet'>;

export function stableHash(value: unknown) {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return item;
  };
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function parseRules(row: { id: string; key: string; name: string; version: number; rules: unknown }): ScoringRuleSetInput {
  const rules = row.rules as Partial<ScoringRuleSetInput['rules']>;
  if (
    !Number.isSafeInteger(rules.exactScore) ||
    !Number.isSafeInteger(rules.correctOutcome) ||
    !Number.isSafeInteger(rules.oneTeamGoals) ||
    !Number.isSafeInteger(rules.miss)
  ) {
    throw new Error(`Invalid scoring rule version ${row.id}.`);
  }
  return { id: row.id, key: row.key, name: row.name, version: row.version, rules: rules as ScoringRuleSetInput['rules'] };
}

function parseTieBreakers(value: unknown): TieBreakerCriterion[] {
  if (!Array.isArray(value)) throw new Error('Tie-break criteria must be an ordered array.');
  const allowedFields = new Set(['points', 'exactScores', 'resultHits', 'oneGoalHits', 'misses']);
  return value.map((item) => {
    const criterion = item as Partial<TieBreakerCriterion>;
    if (
      !criterion.field ||
      !allowedFields.has(criterion.field) ||
      !['asc', 'desc'].includes(criterion.direction ?? '') ||
      typeof criterion.label !== 'string'
    ) throw new Error('Invalid tie-break criterion.');
    return criterion as TieBreakerCriterion;
  });
}

export async function resolvePoolSeasonRules(poolSeasonId: string, database: RuleDatabase = prisma) {
  const poolSeason = await database.poolSeason.findUnique({
    where: { id: poolSeasonId },
    select: {
      id: true,
      scoringRuleSetVersion: { select: { id: true, key: true, name: true, version: true, rules: true } },
      tieBreakerRuleSet: { select: { id: true, key: true, name: true, version: true, criteria: true, allowSharedPositions: true } },
    },
  });
  if (!poolSeason) throw new Error(`PoolSeason ${poolSeasonId} not found.`);

  const scoringRow = poolSeason.scoringRuleSetVersion ?? await database.scoringRuleSetVersion.findUnique({
    where: { id: INITIAL_SCORING_VERSION_ID },
    select: { id: true, key: true, name: true, version: true, rules: true },
  });
  const tieRow = poolSeason.tieBreakerRuleSet ?? await database.tieBreakerRuleSet.findUnique({
    where: { id: INITIAL_TIE_BREAKER_ID },
    select: { id: true, key: true, name: true, version: true, criteria: true, allowSharedPositions: true },
  });

  return {
    scoring: scoringRow ? parseRules(scoringRow) : INITIAL_SCORING_RULE_SET,
    tieBreakers: tieRow
      ? { id: tieRow.id, key: tieRow.key, name: tieRow.name, version: tieRow.version, criteria: parseTieBreakers(tieRow.criteria), allowSharedPositions: tieRow.allowSharedPositions }
      : { id: INITIAL_TIE_BREAKER_ID, key: 'classic-ranking', name: 'Desempate clássico', version: 1, criteria: [...INITIAL_TIE_BREAKERS], allowSharedPositions: true },
  };
}

export function scoreCalculationKey(input: {
  targetId: string;
  resultRevision: string;
  scoringRuleSetVersionId: string;
  actualHomeScore: number;
  actualAwayScore: number;
  isFinal: boolean;
  resultIdentity?: unknown;
  predictionIdentity?: unknown;
}) {
  return stableHash({
    targetId: input.targetId,
    scoringRuleSetVersionId: input.scoringRuleSetVersionId,
    actualHomeScore: input.actualHomeScore,
    actualAwayScore: input.actualAwayScore,
    isFinal: input.isFinal,
    resultIdentity: input.resultIdentity,
    predictionIdentity: input.predictionIdentity,
  });
}
