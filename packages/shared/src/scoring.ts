import type {
  ScoreInput,
  ScoreResult,
  ScoringRuleSetInput,
  ScoringRuleValues,
  TieBreakerCriterion,
} from './types.js';

export const INITIAL_SCORING_RULE_SET = Object.freeze({
  id: 'scoring-rule-set-version-15-3-1-0-v1',
  key: 'classic-15-3-1-0',
  name: 'Pontuação 15/3/1/0',
  version: 1,
  rules: Object.freeze({ exactScore: 15, correctOutcome: 3, oneTeamGoals: 1, miss: 0 }),
}) satisfies ScoringRuleSetInput;

export const BRASILEIRAO_2026_SCORING_RULE_SET = Object.freeze({
  id: 'scoring-rule-set-version-brasileirao-6-3-plus-1-0-v1',
  key: 'brasileirao-6-3-plus-1-0',
  name: 'Brasileirão 6/3+1/1/0',
  version: 1,
  rules: Object.freeze({
    exactScore: 6,
    correctOutcome: 3,
    oneTeamGoals: 1,
    miss: 0,
    addTeamGoalsBonusToCorrectOutcome: true,
  }),
}) satisfies ScoringRuleSetInput;

export const INITIAL_TIE_BREAKERS = Object.freeze([
  { field: 'points', direction: 'desc', label: 'Mais pontos' },
  { field: 'exactScores', direction: 'desc', label: 'Mais placares exatos' },
  { field: 'resultHits', direction: 'desc', label: 'Mais resultados corretos' },
  { field: 'oneGoalHits', direction: 'desc', label: 'Mais gols de uma equipe acertados' },
  { field: 'misses', direction: 'asc', label: 'Menos erros' },
] as const) satisfies readonly TieBreakerCriterion[];

function outcome(home: number, away: number): 'HOME' | 'AWAY' | 'DRAW' {
  if (home > away) return 'HOME';
  if (away > home) return 'AWAY';
  return 'DRAW';
}

function assertRuleValues(rules: ScoringRuleValues) {
  for (const value of [rules.exactScore, rules.correctOutcome, rules.oneTeamGoals, rules.miss]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('Scoring rule points must be non-negative safe integers.');
    }
  }
  if (
    rules.addTeamGoalsBonusToCorrectOutcome !== undefined &&
    typeof rules.addTeamGoalsBonusToCorrectOutcome !== 'boolean'
  ) {
    throw new TypeError('The additive team-goals bonus flag must be boolean.');
  }
}

export function calculatePredictionScore(
  input: ScoreInput,
  ruleSet: ScoringRuleSetInput = INITIAL_SCORING_RULE_SET,
): ScoreResult {
  assertRuleValues(ruleSet.rules);
  const exactScore =
    input.predictedHomeScore === input.actualHomeScore &&
    input.predictedAwayScore === input.actualAwayScore;

  const predictedOutcome = outcome(input.predictedHomeScore, input.predictedAwayScore);
  const actualOutcome = outcome(input.actualHomeScore, input.actualAwayScore);
  const outcomeMatched = predictedOutcome === actualOutcome;
  const homeGoalsMatched = input.predictedHomeScore === input.actualHomeScore;
  const awayGoalsMatched = input.predictedAwayScore === input.actualAwayScore;
  const teamGoalsMatched = homeGoalsMatched || awayGoalsMatched;
  const resultPoints = !exactScore && outcomeMatched ? ruleSet.rules.correctOutcome : 0;
  const teamGoalsBonusPoints =
    !exactScore &&
    teamGoalsMatched &&
    (!outcomeMatched || ruleSet.rules.addTeamGoalsBonusToCorrectOutcome === true)
      ? ruleSet.rules.oneTeamGoals
      : 0;
  const result = exactScore
    ? {
        points: ruleSet.rules.exactScore,
        scoreType: 'EXACT_SCORE' as const,
        criterion: 'EXACT_SCORE' as const,
      }
    : outcomeMatched
      ? {
          points: resultPoints + teamGoalsBonusPoints,
          scoreType: 'RESULT' as const,
          criterion: 'CORRECT_OUTCOME' as const,
        }
      : teamGoalsMatched
        ? {
            points: teamGoalsBonusPoints,
            scoreType: 'ONE_TEAM_GOALS' as const,
            criterion: 'ONE_TEAM_GOALS' as const,
          }
        : { points: ruleSet.rules.miss, scoreType: 'MISS' as const, criterion: 'MISS' as const };

  return {
    points: result.points,
    scoreType: result.scoreType,
    breakdown: {
      criterion: result.criterion,
      awardedPoints: result.points,
      resultPoints,
      teamGoalsBonusPoints,
      totalPoints: result.points,
      exactScore,
      outcomeMatched,
      homeGoalsMatched,
      awayGoalsMatched,
      rule: { ...ruleSet.rules },
    },
  };
}

export function scoreBreakdownHasTeamGoalsHit(
  scoreType: ScoreResult['scoreType'],
  breakdown: unknown,
) {
  if (scoreType === 'ONE_TEAM_GOALS') return true;
  if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) return false;
  const value = breakdown as Record<string, unknown>;
  if (typeof value.teamGoalsBonusPoints === 'number') return value.teamGoalsBonusPoints > 0;
  if (scoreType !== 'RESULT' || value.exactScore === true) return false;
  const rule =
    value.rule && typeof value.rule === 'object' && !Array.isArray(value.rule)
      ? (value.rule as Record<string, unknown>)
      : null;
  return (
    rule?.addTeamGoalsBonusToCorrectOutcome === true &&
    (value.homeGoalsMatched === true || value.awayGoalsMatched === true)
  );
}

export function compareByTieBreakers<T extends Record<TieBreakerCriterion['field'], number>>(
  left: T,
  right: T,
  criteria: readonly TieBreakerCriterion[] = INITIAL_TIE_BREAKERS,
) {
  for (const criterion of criteria) {
    const difference = left[criterion.field] - right[criterion.field];
    if (difference !== 0) return criterion.direction === 'asc' ? difference : -difference;
  }
  return 0;
}
