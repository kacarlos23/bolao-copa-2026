import { describe, expect, it } from 'vitest';
import type { CollectedCbfTeamProfile } from './cbf-team-profile.provider.js';
import { shouldApplyCbfTeamProfile } from './team-profile.importer.js';

function profile(athleteIds: string[], matchIds: string[], checksum: string) {
  return {
    externalTeamId: 'team-1',
    name: 'Time 1',
    state: 'SP',
    sourceUrl:
      'https://www.cbf.com.br/futebol-brasileiro/times/campeonato-brasileiro-serie-a/time-1/1',
    collectedAt: '2026-07-22T12:00:00.000Z',
    checksum,
    statistics: {
      goalsFor: 1,
      goalsAgainst: 0,
      cleanSheets: 1,
      played: matchIds.length,
      wins: matchIds.length,
      draws: 0,
      losses: 0,
      yellowCards: 0,
      redCards: 0,
    },
    athletes: athleteIds.map((externalId) => ({
      externalId,
      fullName: `Atleta ${externalId}`,
      nickname: null,
      currentClub: { externalId: 'team-1', name: 'Time 1', state: 'SP' },
    })),
    matches: matchIds.map((externalId) => ({
      externalId,
      reference: externalId,
      round: 1,
      startsAt: '2026-07-22T12:00:00.000Z',
      home: { externalId: 'team-1', name: 'Time 1', score: 1 },
      away: { externalId: 'team-2', name: 'Time 2', score: 0 },
      venue: 'Estádio',
      result: 'WIN' as const,
    })),
  } satisfies CollectedCbfTeamProfile;
}

describe('CBF team profile refresh stability', () => {
  it('does not rewrite an identical snapshot', () => {
    const incoming = profile(['1'], ['match-1'], 'a'.repeat(64));
    expect(
      shouldApplyCbfTeamProfile(
        { checksum: incoming.checksum, athletes: incoming.athletes, matches: incoming.matches },
        incoming,
      ),
    ).toBe(false);
  });

  it('rejects a stale edge replica that drops cumulative athletes or matches', () => {
    const incoming = profile(['1'], ['match-1'], 'b'.repeat(64));
    expect(
      shouldApplyCbfTeamProfile(
        {
          checksum: 'a'.repeat(64),
          athletes: profile(['1', '2'], ['match-1', 'match-2'], 'a'.repeat(64)).athletes,
          matches: profile(['1', '2'], ['match-1', 'match-2'], 'a'.repeat(64)).matches,
        },
        incoming,
      ),
    ).toBe(false);
  });

  it('accepts cumulative official information', () => {
    const incoming = profile(['1', '2'], ['match-1', 'match-2'], 'b'.repeat(64));
    expect(
      shouldApplyCbfTeamProfile(
        {
          checksum: 'a'.repeat(64),
          athletes: profile(['1'], ['match-1'], 'a'.repeat(64)).athletes,
          matches: profile(['1'], ['match-1'], 'a'.repeat(64)).matches,
        },
        incoming,
      ),
    ).toBe(true);
  });
});
