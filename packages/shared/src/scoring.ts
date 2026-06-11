import type { ScoreInput, ScoreResult } from './types.js';

function outcome(home: number, away: number): 'HOME' | 'AWAY' | 'DRAW' {
  if (home > away) return 'HOME';
  if (away > home) return 'AWAY';
  return 'DRAW';
}

export function calculatePredictionScore(input: ScoreInput): ScoreResult {
  const exactScore =
    input.predictedHomeScore === input.actualHomeScore &&
    input.predictedAwayScore === input.actualAwayScore;

  if (exactScore) {
    return { points: 7, scoreType: 'EXACT_SCORE' };
  }

  const predictedOutcome = outcome(input.predictedHomeScore, input.predictedAwayScore);
  const actualOutcome = outcome(input.actualHomeScore, input.actualAwayScore);

  if (predictedOutcome === actualOutcome) {
    return { points: 3, scoreType: 'RESULT' };
  }

  const oneTeamGoals =
    input.predictedHomeScore === input.actualHomeScore ||
    input.predictedAwayScore === input.actualAwayScore;

  if (oneTeamGoals) {
    return { points: 1, scoreType: 'ONE_TEAM_GOALS' };
  }

  return { points: 0, scoreType: 'MISS' };
}
