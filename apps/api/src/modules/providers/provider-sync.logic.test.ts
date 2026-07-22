import { describe, expect, it } from 'vitest';
import {
  chooseMatchIdentity,
  partitionDuplicateExternalIds,
  resultUpdateAllowed,
  uniqueGlobalClubCandidate,
  uniqueNameCandidate,
  valuesAfterManualOverride,
} from './provider-sync.logic.js';

describe('provider reconciliation invariants', () => {
  it('quarantines every duplicate external ID instead of selecting one row', () => {
    const partition = partitionDuplicateExternalIds([
      { externalId: 'same', value: 1 },
      { externalId: 'same', value: 2 },
      { externalId: 'unique', value: 3 },
    ]);
    expect(partition.accepted).toEqual([{ externalId: 'unique', value: 3 }]);
    expect(partition.duplicates).toHaveLength(2);
  });

  it('does not silently choose a normalized-name ambiguity', () => {
    const resolution = uniqueNameCandidate('Atlético-MG', [
      { id: 'one', name: 'Atletico MG' },
      { id: 'two', name: 'Atlético-MG' },
    ]);
    expect(resolution.candidate).toBeNull();
    expect(resolution.matches).toHaveLength(2);
  });

  it('reuses a unique global club for a Libertadores-to-Sudamericana transfer', () => {
    const existingLibertadoresTeam = {
      id: 'global-team-santos',
      name: 'Santos FC',
      countryCode: 'BRA',
    };
    const resolution = uniqueGlobalClubCandidate('Santos FC', 'BRA', [
      existingLibertadoresTeam,
      { id: 'club-from-another-country', name: 'Santos FC', countryCode: 'BOL' },
    ]);

    expect(resolution.candidate).toEqual(existingLibertadoresTeam);
    expect(resolution.matches).toHaveLength(1);
  });

  it('keeps homonymous club identities separated by association country', () => {
    const resolution = uniqueGlobalClubCandidate('Racing', 'URY', [
      { id: 'racing-arg', name: 'Racing Club', countryCode: 'ARG' },
      { id: 'racing-ury', name: 'Racing', countryCode: 'URY' },
    ]);

    expect(resolution.candidate?.id).toBe('racing-ury');
    expect(resolution.matches).toHaveLength(1);
  });

  it('allows a corrected FINISHED score but blocks automatic status regression', () => {
    expect(resultUpdateAllowed('FINISHED', 'FINISHED')).toBe(true);
    expect(resultUpdateAllowed('FINISHED', 'LIVE')).toBe(false);
    expect(resultUpdateAllowed('FINISHED', 'SCHEDULED')).toBe(false);
  });

  it('preserves the mapped Match ID when kickoff is rescheduled', () => {
    const initiallyReconciled = chooseMatchIdentity(null, ['match-internal-1']);
    const afterReschedule = chooseMatchIdentity(initiallyReconciled.internalId, []);
    expect(afterReschedule).toEqual({ internalId: 'match-internal-1', ambiguous: false });
  });

  it('keeps audited manual values over later synchronized values', () => {
    expect(
      valuesAfterManualOverride(
        { status: 'FINISHED', homeScore: 3, awayScore: 0 },
        { homeScore: 2, awayScore: 1 },
      ),
    ).toEqual({ status: 'FINISHED', homeScore: 2, awayScore: 1 });
  });
});
