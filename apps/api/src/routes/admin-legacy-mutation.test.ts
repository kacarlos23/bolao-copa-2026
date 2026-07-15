import { describe, expect, it } from 'vitest';
import { isAuditedCompetitionFeatureMutation } from './admin-legacy-mutation.js';

describe('audited legacy admin mutation allowlist', () => {
  it('allows only the competition feature flag update route', () => {
    expect(isAuditedCompetitionFeatureMutation('PUT', '/seasons/season-1/features')).toBe(true);
    expect(isAuditedCompetitionFeatureMutation('POST', '/seasons/season-1/features')).toBe(false);
    expect(isAuditedCompetitionFeatureMutation('PUT', '/users/user-1/status')).toBe(false);
    expect(isAuditedCompetitionFeatureMutation('PUT', '/seasons/season-1/features/extra')).toBe(false);
  });
});
