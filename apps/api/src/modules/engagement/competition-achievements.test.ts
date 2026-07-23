import { describe, expect, it } from 'vitest';
import {
  buildCupAchievementDefinitions,
  deriveConfiguredAchievementFact,
  type AchievementMatchFact,
  type AchievementScoreFact,
} from './competition-achievements.js';

const context = {
  seasonId: 'season-a',
  poolSeasonId: 'pool-season-a',
  userId: 'user-a',
};

function match(
  input: Partial<AchievementMatchFact> & Pick<AchievementMatchFact, 'matchId'>,
): AchievementMatchFact {
  return {
    seasonId: context.seasonId,
    stageId: 'stage-knockout',
    stageType: 'KNOCKOUT',
    roundId: 'round-1',
    roundOrder: 1,
    tieId: null,
    legNumber: null,
    expectedLegs: null,
    status: 'FINISHED',
    scoreable: true,
    ...input,
  };
}

function score(
  input: Partial<AchievementScoreFact> & Pick<AchievementScoreFact, 'matchId'>,
): AchievementScoreFact {
  return {
    seasonId: context.seasonId,
    poolSeasonId: context.poolSeasonId,
    userId: context.userId,
    points: 15,
    scoreType: 'EXACT_SCORE',
    isFinal: true,
    ...input,
  };
}

describe('configured cup achievements', () => {
  it('builds a season-specific catalogue without changing match scoring', () => {
    const definitions = buildCupAchievementDefinitions({
      keyPrefix: 'SUDAMERICANA_2026',
      includeGroupStage: true,
      playoffsRoundOrder: 1,
      finalRoundOrder: 5,
      championName: 'Campeão da Sul-Americana no Bolão',
    });

    expect(definitions.map((definition) => definition.name)).toEqual([
      'Mestre da Fase de Grupos',
      'Rei dos Playoffs',
      'Especialista em Mata-Mata',
      'Cravou Ida e Volta',
      'Cravou na Final',
      'Campeão da Sul-Americana no Bolão',
    ]);
    expect(definitions.every((definition) => !('points' in definition.criteria))).toBe(true);
  });

  it('does not consolidate a scope leader while a match is LIVE and recomputes corrections', () => {
    const criterion = {
      type: 'scopeLeader',
      scope: { stageType: 'GROUP' },
    } as const;
    const matches = [
      match({ matchId: 'group-1', stageType: 'GROUP', stageId: 'groups' }),
      match({
        matchId: 'group-2',
        stageType: 'GROUP',
        stageId: 'groups',
        status: 'LIVE',
      }),
    ];
    const scores = [
      score({ matchId: 'group-1', points: 15 }),
      score({
        matchId: 'group-1',
        userId: 'user-b',
        points: 3,
        scoreType: 'RESULT',
      }),
    ];

    expect(
      deriveConfiguredAchievementFact({
        ...context,
        criterion,
        matches,
        scores,
        seasonFinished: false,
      }),
    ).toMatchObject({ satisfied: false, provisional: false });

    const completed = matches.map((item) => ({ ...item, status: 'FINISHED' }));
    const first = deriveConfiguredAchievementFact({
      ...context,
      criterion,
      matches: completed,
      scores,
      seasonFinished: false,
    });
    const replay = deriveConfiguredAchievementFact({
      ...context,
      criterion,
      matches: [...completed],
      scores: [...scores],
      seasonFinished: false,
    });
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ satisfied: true, progress: { points: 15 } });

    const corrected = deriveConfiguredAchievementFact({
      ...context,
      criterion,
      matches: completed,
      scores: [
        score({ matchId: 'group-1', points: 0, scoreType: 'MISS' }),
        score({ matchId: 'group-1', userId: 'user-b', points: 15 }),
      ],
      seasonFinished: false,
    });
    expect(corrected).toMatchObject({ satisfied: false, progress: { points: 0 } });
  });

  it('awards two exact final legs once, independent of a penalty decision', () => {
    const matches = [
      match({
        matchId: 'leg-1',
        tieId: 'tie-1',
        legNumber: 1,
        expectedLegs: 2,
      }),
      match({
        matchId: 'leg-2',
        tieId: 'tie-1',
        legNumber: 2,
        expectedLegs: 2,
      }),
    ];
    const criterion = { type: 'twoLegExact', requiredLegs: 2 } as const;
    const fact = deriveConfiguredAchievementFact({
      ...context,
      criterion,
      matches,
      scores: [score({ matchId: 'leg-1' }), score({ matchId: 'leg-2' })],
      seasonFinished: false,
    });

    expect(fact).toEqual({
      satisfied: true,
      provisional: false,
      progress: { current: 2, target: 2, tieId: 'tie-1' },
    });
  });

  it('ignores historical, cross-season and cross-pool scores', () => {
    const criterion = {
      type: 'exactCount',
      scope: { stageType: 'KNOCKOUT' },
      minimum: 1,
    } as const;
    const fact = deriveConfiguredAchievementFact({
      ...context,
      criterion,
      matches: [
        match({ matchId: 'historical', scoreable: false }),
        match({ matchId: 'other-season', seasonId: 'season-b' }),
        match({ matchId: 'eligible' }),
      ],
      scores: [
        score({ matchId: 'historical' }),
        score({ matchId: 'other-season', seasonId: 'season-b' }),
        score({ matchId: 'eligible', poolSeasonId: 'pool-season-b' }),
      ],
      seasonFinished: false,
    });

    expect(fact).toEqual({
      satisfied: false,
      provisional: false,
      progress: { current: 0, target: 1 },
    });
  });

  it('identifies each season champion only after the isolated season finishes', () => {
    const criterion = { type: 'seasonLeader' } as const;
    const matches = [match({ matchId: 'final', roundOrder: 5 })];
    const scores = [
      score({ matchId: 'final', points: 15 }),
      score({ matchId: 'final', userId: 'user-b', points: 3, scoreType: 'RESULT' }),
    ];

    expect(
      deriveConfiguredAchievementFact({
        ...context,
        criterion,
        matches,
        scores,
        seasonFinished: false,
      }),
    ).toMatchObject({ satisfied: false });
    expect(
      deriveConfiguredAchievementFact({
        ...context,
        criterion,
        matches,
        scores,
        seasonFinished: true,
      }),
    ).toMatchObject({ satisfied: true, progress: { complete: true } });
  });
});
