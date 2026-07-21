import { describe, expect, it } from 'vitest';
import { prioritizeAdminMatches } from './adminOperations.logic';

describe('prioritizeAdminMatches', () => {
  it('places every match from today first and keeps them in kickoff order', () => {
    const now = new Date('2026-07-17T15:00:00.000Z');
    const matches = [
      { id: 'past', startsAt: '2026-07-16T19:00:00.000Z', status: 'FINISHED' },
      { id: 'future', startsAt: '2026-07-18T19:00:00.000Z', status: 'SCHEDULED' },
      { id: 'today-late', startsAt: '2026-07-18T00:30:00.000Z', status: 'SCHEDULED' },
      { id: 'today-early', startsAt: '2026-07-17T22:00:00.000Z', status: 'LIVE' },
    ];

    expect(
      prioritizeAdminMatches(matches, now, 'America/Sao_Paulo').map((match) => match.id),
    ).toEqual(['today-early', 'today-late', 'future', 'past']);
  });

  it('places an off-date live match before other future and past matches', () => {
    const now = new Date('2026-07-17T15:00:00.000Z');
    const matches = [
      { id: 'future', startsAt: '2026-07-19T19:00:00.000Z', status: 'SCHEDULED' },
      { id: 'live', startsAt: '2026-07-16T19:00:00.000Z', status: 'LIVE' },
      { id: 'past', startsAt: '2026-07-15T19:00:00.000Z', status: 'FINISHED' },
    ];

    expect(prioritizeAdminMatches(matches, now).map((match) => match.id)).toEqual([
      'live',
      'future',
      'past',
    ]);
  });
});
