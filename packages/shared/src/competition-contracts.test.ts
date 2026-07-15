import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  listMatchesQuerySchema,
  realtimeEventEnvelopeSchema,
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
});
