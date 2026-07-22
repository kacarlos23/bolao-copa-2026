import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  listMatchesQuerySchema,
  matchDtoSchema,
  realtimeEventEnvelopeSchema,
  tieDtoSchema,
  teamProfileDtoSchema,
  upsertSeasonPredictionsSchema,
} from './competition-contracts.js';

describe('generic competition contracts', () => {
  it('rejects unknown keys and duplicate matches in writes', () => {
    expect(() =>
      upsertSeasonPredictionsSchema.parse({
        matchDayId: 'day-1',
        predictions: [
          { matchId: 'match-1', predictedHomeScore: 1, predictedAwayScore: 0 },
          { matchId: 'match-1', predictedHomeScore: 2, predictedAwayScore: 0 },
        ],
        seasonId: 'must-not-be-trusted-from-body',
      }),
    ).toThrow();
  });

  it('keeps regulation, extra time, penalties, aggregate and winner unambiguous', () => {
    const teamA = { id: 'team-a', name: 'A', code: null, flagUrl: null, crestUrl: null };
    const teamB = { id: 'team-b', name: 'B', code: null, flagUrl: null, crestUrl: null };
    const tie = {
      id: 'tie-1',
      seasonId: 'season-1',
      stageId: 'stage-1',
      roundId: 'round-1',
      key: 'final',
      order: 1,
      expectedLegs: 1,
      status: 'DECIDED',
      decisionMethod: 'PENALTIES',
      aggregateTeamAScore: 1,
      aggregateTeamBScore: 1,
      decidedAt: '2026-07-21T12:00:00.000Z',
      lastRecomputedAt: '2026-07-21T12:00:00.000Z',
      provenance: 'fixture:test',
      metadata: null,
      teamA,
      teamB,
      winnerTeam: teamA,
      matches: [
        {
          id: 'match-1',
          seasonId: 'season-1',
          stageId: 'stage-1',
          roundId: 'round-1',
          tieId: 'tie-1',
          legNumber: 1,
          matchDayId: 'day-1',
          startsAt: '2026-07-21T10:00:00.000Z',
          predictionClosesAt: null,
          status: 'FINISHED',
          homeScore: 1,
          awayScore: 1,
          finalHomeScore: null,
          finalAwayScore: null,
          regulationHomeScore: 1,
          regulationAwayScore: 1,
          extraTimeHomeScore: 0,
          extraTimeAwayScore: 0,
          penaltyHomeScore: 5,
          penaltyAwayScore: 4,
          homeTeam: teamA,
          awayTeam: teamB,
        },
      ],
    };

    expect(tieDtoSchema.parse(tie)).toEqual(tie);
    expect(() =>
      tieDtoSchema.parse({
        ...tie,
        matches: [{ ...tie.matches[0], regulationAwayScore: undefined }],
      }),
    ).toThrow();
  });

  it('defaults additive Tie fields to null for legacy Match payloads', () => {
    const team = { id: 'team-a', name: 'A', code: null, flagUrl: null, crestUrl: null };
    const parsed = matchDtoSchema.parse({
      id: 'match-legacy',
      seasonId: 'season-1',
      stageId: null,
      roundId: null,
      matchDayId: 'day-1',
      startsAt: '2026-07-21T10:00:00.000Z',
      predictionClosesAt: null,
      status: 'FINISHED',
      homeScore: 1,
      awayScore: 0,
      finalHomeScore: 1,
      finalAwayScore: 0,
      homeTeam: team,
      awayTeam: { ...team, id: 'team-b', name: 'B' },
    });

    expect(parsed).toMatchObject({
      tieId: null,
      legNumber: null,
      regulationHomeScore: null,
      extraTimeHomeScore: null,
      penaltyHomeScore: null,
    });
  });

  it('coerces bounded pagination while keeping query schemas strict', () => {
    expect(listMatchesQuerySchema.parse({ page: '2', pageSize: '10', status: 'LIVE' })).toEqual({
      page: 2,
      pageSize: 10,
      status: 'LIVE',
    });
    expect(() => listMatchesQuerySchema.parse({ pageSize: 101 })).toThrow();
    expect(() => listMatchesQuerySchema.parse({ include: 'everything' })).toThrow();
  });

  it('documents safe errors and filterable versioned events', () => {
    expect(
      apiErrorSchema.parse({
        error: {
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Dados inválidos.',
          issues: [{ path: ['body', 0], message: 'Inválido.' }],
          requestId: 'request-1',
        },
      }),
    ).toBeTruthy();

    expect(
      realtimeEventEnvelopeSchema.parse({
        eventId: 'event-1',
        type: 'prediction.updated',
        occurredAt: '2026-07-14T12:00:00.000Z',
        seasonId: 'season-1',
        poolSeasonId: 'pool-season-1',
        version: 1,
        payload: { matchIds: ['match-1'] },
      }),
    ).toBeTruthy();
  });

  it('validates a complete official team profile without admitting raw provider fields', () => {
    const profile = {
      seasonId: 'season-1',
      team: { id: 'team-1', name: 'Time', code: 'TIM', flagUrl: null, crestUrl: null },
      externalId: '123',
      state: 'SP',
      athletes: [
        {
          externalId: 'athlete-1',
          fullName: 'Nome Completo',
          nickname: 'Nome',
          currentClub: { externalId: '123', name: 'Time', state: 'SP' },
        },
      ],
      matches: [],
      statistics: {
        goalsFor: 0,
        goalsAgainst: 0,
        cleanSheets: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        yellowCards: 0,
        redCards: 0,
      },
      source: {
        provider: 'CBF',
        label: 'CBF',
        url: 'https://www.cbf.com.br/time/123',
        collectedAt: '2026-07-16T12:00:00.000Z',
        checksum: 'a'.repeat(64),
      },
    };
    expect(teamProfileDtoSchema.parse(profile)).toEqual(profile);
    expect(() => teamProfileDtoSchema.parse({ ...profile, rawPayload: {} })).toThrow();
  });
});
