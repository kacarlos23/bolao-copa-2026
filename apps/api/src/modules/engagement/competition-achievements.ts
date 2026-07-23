import { compareByTieBreakers } from '@bolao/shared';
import type { ScoreType, StageType } from '@prisma/client';
import { z } from 'zod';

const achievementScopeSchema = z
  .object({
    stageType: z.enum(['LEAGUE', 'GROUP', 'KNOCKOUT']).optional(),
    roundOrder: z.number().int().positive().optional(),
  })
  .strict();

export const competitionAchievementCriterionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('scopeLeader'),
      scope: achievementScopeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('exactCount'),
      scope: achievementScopeSchema,
      minimum: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('twoLegExact'),
      requiredLegs: z.number().int().min(2),
    })
    .strict(),
  z
    .object({
      type: z.literal('seasonLeader'),
    })
    .strict(),
]);

export type CompetitionAchievementCriterion = z.infer<typeof competitionAchievementCriterionSchema>;

export interface SeasonAchievementDefinition {
  key: string;
  version: number;
  name: string;
  description: string;
  rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  criteria: CompetitionAchievementCriterion;
}

export interface AchievementMatchFact {
  seasonId: string;
  matchId: string;
  stageId: string | null;
  stageType: StageType | null;
  roundId: string | null;
  roundOrder: number | null;
  tieId: string | null;
  legNumber: number | null;
  expectedLegs: number | null;
  status: string;
  scoreable: boolean;
}

export interface AchievementScoreFact {
  seasonId: string;
  poolSeasonId: string;
  userId: string;
  matchId: string;
  points: number;
  scoreType: ScoreType;
  isFinal: boolean;
}

export interface ConfiguredAchievementFact {
  satisfied: boolean;
  provisional: false;
  progress: Record<string, string | number | boolean | null>;
}

function matchesScope(match: AchievementMatchFact, scope: z.infer<typeof achievementScopeSchema>) {
  return (
    (scope.stageType == null || match.stageType === scope.stageType) &&
    (scope.roundOrder == null || match.roundOrder === scope.roundOrder)
  );
}

function finalScoresForMatches(scores: AchievementScoreFact[], matches: AchievementMatchFact[]) {
  const finishedMatchIds = new Set(
    matches.filter((match) => match.status === 'FINISHED').map((match) => match.matchId),
  );
  return scores.filter((score) => score.isFinal && finishedMatchIds.has(score.matchId));
}

function rankingRows(scores: AchievementScoreFact[]) {
  const rows = new Map<
    string,
    {
      userId: string;
      points: number;
      exactScores: number;
      resultHits: number;
      oneGoalHits: number;
      misses: number;
    }
  >();
  for (const score of scores) {
    const row = rows.get(score.userId) ?? {
      userId: score.userId,
      points: 0,
      exactScores: 0,
      resultHits: 0,
      oneGoalHits: 0,
      misses: 0,
    };
    row.points += score.points;
    if (score.scoreType === 'EXACT_SCORE') row.exactScores += 1;
    if (score.scoreType === 'RESULT') row.resultHits += 1;
    if (score.scoreType === 'ONE_TEAM_GOALS') row.oneGoalHits += 1;
    if (score.scoreType === 'MISS') row.misses += 1;
    rows.set(score.userId, row);
  }
  return [...rows.values()].sort(
    (left, right) => compareByTieBreakers(left, right) || left.userId.localeCompare(right.userId),
  );
}

function leaderFact(
  userId: string,
  matches: AchievementMatchFact[],
  scores: AchievementScoreFact[],
): ConfiguredAchievementFact {
  const complete = matches.length > 0 && matches.every((match) => match.status === 'FINISHED');
  const rows = rankingRows(finalScoresForMatches(scores, matches));
  const leader = rows[0];
  const user = rows.find((row) => row.userId === userId);
  const tiedForLead = Boolean(
    complete && leader && user && compareByTieBreakers(leader, user) === 0,
  );
  return {
    satisfied: tiedForLead,
    provisional: false,
    progress: {
      current: tiedForLead ? 1 : 0,
      target: 1,
      complete,
      points: user?.points ?? 0,
    },
  };
}

function twoLegExactFact(
  userId: string,
  requiredLegs: number,
  matches: AchievementMatchFact[],
  scores: AchievementScoreFact[],
): ConfiguredAchievementFact {
  const byTie = new Map<string, AchievementMatchFact[]>();
  for (const match of matches) {
    if (!match.tieId || (match.expectedLegs ?? 0) < requiredLegs) continue;
    const tieMatches = byTie.get(match.tieId) ?? [];
    tieMatches.push(match);
    byTie.set(match.tieId, tieMatches);
  }
  const exactMatchIds = new Set(
    scores
      .filter(
        (score) => score.userId === userId && score.isFinal && score.scoreType === 'EXACT_SCORE',
      )
      .map((score) => score.matchId),
  );
  let best = 0;
  let achievedTieId: string | null = null;
  for (const [tieId, tieMatches] of byTie) {
    const completed = tieMatches
      .filter((match) => match.status === 'FINISHED')
      .sort((left, right) => (left.legNumber ?? 0) - (right.legNumber ?? 0));
    const exactLegs = completed.filter((match) => exactMatchIds.has(match.matchId)).length;
    best = Math.max(best, exactLegs);
    if (
      completed.length >= requiredLegs &&
      completed.slice(0, requiredLegs).every((match) => exactMatchIds.has(match.matchId))
    ) {
      achievedTieId = tieId;
      break;
    }
  }
  return {
    satisfied: achievedTieId != null,
    provisional: false,
    progress: {
      current: achievedTieId ? requiredLegs : best,
      target: requiredLegs,
      tieId: achievedTieId,
    },
  };
}

export function deriveConfiguredAchievementFact(input: {
  seasonId: string;
  poolSeasonId: string;
  userId: string;
  criterion: unknown;
  matches: AchievementMatchFact[];
  scores: AchievementScoreFact[];
  seasonFinished: boolean;
}): ConfiguredAchievementFact | null {
  const parsed = competitionAchievementCriterionSchema.safeParse(input.criterion);
  if (!parsed.success) return null;
  const criterion = parsed.data;
  const matches = input.matches.filter(
    (match) => match.seasonId === input.seasonId && match.scoreable,
  );
  const scores = input.scores.filter(
    (score) => score.seasonId === input.seasonId && score.poolSeasonId === input.poolSeasonId,
  );

  if (criterion.type === 'scopeLeader') {
    const scopedMatches = matches.filter((match) => matchesScope(match, criterion.scope));
    return leaderFact(input.userId, scopedMatches, scores);
  }
  if (criterion.type === 'exactCount') {
    const scopedMatches = matches.filter((match) => matchesScope(match, criterion.scope));
    const matchIds = new Set(
      scopedMatches.filter((match) => match.status === 'FINISHED').map((match) => match.matchId),
    );
    const count = scores.filter(
      (score) =>
        score.userId === input.userId &&
        score.isFinal &&
        score.scoreType === 'EXACT_SCORE' &&
        matchIds.has(score.matchId),
    ).length;
    return {
      satisfied: count >= criterion.minimum,
      provisional: false,
      progress: { current: count, target: criterion.minimum },
    };
  }
  if (criterion.type === 'twoLegExact') {
    return twoLegExactFact(input.userId, criterion.requiredLegs, matches, scores);
  }
  const allMatchesFinished =
    matches.length > 0 && matches.every((match) => match.status === 'FINISHED');
  if (!input.seasonFinished || !allMatchesFinished) {
    return {
      satisfied: false,
      provisional: false,
      progress: { current: 0, target: 1, complete: false },
    };
  }
  return leaderFact(input.userId, matches, scores);
}

export function buildCupAchievementDefinitions(input: {
  keyPrefix: string;
  includeGroupStage: boolean;
  playoffsRoundOrder?: number;
  finalRoundOrder: number;
  championName: string;
}): SeasonAchievementDefinition[] {
  const definitions: SeasonAchievementDefinition[] = [];
  if (input.includeGroupStage) {
    definitions.push({
      key: `${input.keyPrefix}_GROUP_STAGE_MASTER`,
      version: 1,
      name: 'Mestre da Fase de Grupos',
      description: 'Terminou a fase de grupos na liderança do ranking da temporada.',
      rarity: 'EPIC',
      criteria: { type: 'scopeLeader', scope: { stageType: 'GROUP' } },
    });
  }
  if (input.playoffsRoundOrder != null) {
    definitions.push({
      key: `${input.keyPrefix}_PLAYOFF_KING`,
      version: 1,
      name: 'Rei dos Playoffs',
      description: 'Terminou os playoffs na liderança do ranking da temporada.',
      rarity: 'EPIC',
      criteria: {
        type: 'scopeLeader',
        scope: { stageType: 'KNOCKOUT', roundOrder: input.playoffsRoundOrder },
      },
    });
  }
  definitions.push(
    {
      key: `${input.keyPrefix}_KNOCKOUT_SPECIALIST`,
      version: 1,
      name: 'Especialista em Mata-Mata',
      description: 'Cravou três placares em partidas eliminatórias finalizadas.',
      rarity: 'RARE',
      criteria: {
        type: 'exactCount',
        scope: { stageType: 'KNOCKOUT' },
        minimum: 3,
      },
    },
    {
      key: `${input.keyPrefix}_TWO_LEG_EXACT`,
      version: 1,
      name: 'Cravou Ida e Volta',
      description: 'Cravou os placares dos dois jogos de um confronto eliminatório.',
      rarity: 'EPIC',
      criteria: { type: 'twoLegExact', requiredLegs: 2 },
    },
    {
      key: `${input.keyPrefix}_FINAL_EXACT`,
      version: 1,
      name: 'Cravou na Final',
      description: 'Cravou o placar da final no tempo regulamentar.',
      rarity: 'LEGENDARY',
      criteria: {
        type: 'exactCount',
        scope: { stageType: 'KNOCKOUT', roundOrder: input.finalRoundOrder },
        minimum: 1,
      },
    },
    {
      key: `${input.keyPrefix}_POOL_CHAMPION`,
      version: 1,
      name: input.championName,
      description: 'Terminou a temporada na liderança definitiva do bolão.',
      rarity: 'LEGENDARY',
      criteria: { type: 'seasonLeader' },
    },
  );
  return definitions;
}
