import { describe, expect, it, vi } from 'vitest';
import {
  assertLegacyTieShadowParity,
  legacyKnockoutTieExternalId,
  shadowReadLegacyKnockoutFixture,
  type GenericTieShadow,
  type LegacyKnockoutFixtureShadow,
} from './legacy-knockout-tie.adapter.js';

const fixture: LegacyKnockoutFixtureShadow = {
  id: 'fixture-1',
  seasonId: 'season-1',
  status: 'FINISHED',
  homeTeamId: 'team-a',
  awayTeamId: 'team-b',
  winnerTeamId: 'team-a',
  homeScore: 1,
  awayScore: 0,
  finalHomeScore: null,
  finalAwayScore: null,
};

const tie: GenericTieShadow = {
  id: 'tie-1',
  seasonId: 'season-1',
  expectedLegs: 1,
  status: 'DECIDED',
  decisionMethod: 'AGGREGATE',
  teamAId: 'team-b',
  teamBId: 'team-a',
  winnerTeamId: 'team-a',
  aggregateTeamAScore: 0,
  aggregateTeamBScore: 1,
};

describe('legacy knockout Tie shadow adapter', () => {
  it('uses a stable provider alias without changing legacy IDs', () => {
    expect(legacyKnockoutTieExternalId('fixture-1')).toBe('knockout-fixture:fixture-1');
  });

  it('emits parity and always returns the exact legacy source object', () => {
    const emitMetric = vi.fn();
    const effective = shadowReadLegacyKnockoutFixture(fixture, tie, emitMetric);

    expect(effective).toBe(fixture);
    expect(emitMetric).toHaveBeenCalledOnce();
    expect(emitMetric).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'match', legacyFixtureId: 'fixture-1', tieId: 'tie-1' }),
    );
  });

  it('measures missing and mismatched shadows while the parity gate blocks them', () => {
    const missingMetric = vi.fn();
    shadowReadLegacyKnockoutFixture(fixture, null, missingMetric);
    expect(missingMetric).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'missing' }));
    expect(() => assertLegacyTieShadowParity(fixture, null)).toThrow(/parity gate failed/);

    const divergent = { ...tie, winnerTeamId: 'team-b' };
    const mismatchMetric = vi.fn();
    expect(shadowReadLegacyKnockoutFixture(fixture, divergent, mismatchMetric)).toBe(fixture);
    expect(mismatchMetric).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'mismatch' }));
    expect(() => assertLegacyTieShadowParity(fixture, divergent)).toThrow(/mismatch/);
  });
});
