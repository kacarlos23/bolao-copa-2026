import { describe, expect, it } from 'vitest';
import {
  assertCompetitionFeatureState,
  classifyCompetitionFeatureState,
  type CompetitionFeatureSwitches,
} from './competition-feature-policy.js';

const closed: CompetitionFeatureSwitches = {
  readEnabled: false,
  writeEnabled: false,
  uiEnabled: false,
  syncEnabled: false,
};

describe('matriz CompetitionSeason.status x feature flags', () => {
  it.each([
    ['DRAFT', closed, 'CLOSED'],
    ['DRAFT', { ...closed, syncEnabled: true }, 'BACKSTAGE_SYNC'],
    [
      'DRAFT',
      { readEnabled: true, writeEnabled: true, uiEnabled: true, syncEnabled: true },
      'RESTORED_DRAFT',
    ],
    ['ACTIVE', { ...closed, syncEnabled: true }, 'BACKSTAGE_SYNC'],
    ['ACTIVE', { ...closed, readEnabled: true }, 'READ_ONLY'],
    [
      'ACTIVE',
      { ...closed, readEnabled: true, syncEnabled: true },
      'READ_AND_SYNC',
    ],
    [
      'ACTIVE',
      { readEnabled: true, writeEnabled: true, uiEnabled: true, syncEnabled: true },
      'PUBLIC_AND_SYNC',
    ],
    ['FINISHED', { ...closed, readEnabled: true, uiEnabled: true }, 'PUBLIC'],
    ['ARCHIVED', { ...closed, readEnabled: true }, 'READ_ONLY'],
  ] as const)('aceita %s como %s', (status, flags, expected) => {
    expect(classifyCompetitionFeatureState(status, flags)).toBe(expected);
  });

  it.each([
    ['DRAFT', { ...closed, readEnabled: true }],
    ['DRAFT', { ...closed, uiEnabled: true }],
    ['ACTIVE', { ...closed, writeEnabled: true }],
    ['ACTIVE', { ...closed, uiEnabled: true }],
    ['FINISHED', { ...closed, readEnabled: true, writeEnabled: true }],
    ['FINISHED', { ...closed, syncEnabled: true }],
    ['ARCHIVED', { ...closed, readEnabled: true, syncEnabled: true }],
  ] as const)('falha fechado para combinação inválida em %s', (status, flags) => {
    expect(classifyCompetitionFeatureState(status, flags)).toBeNull();
    expect(() => assertCompetitionFeatureState(status, flags)).toThrowError(
      expect.objectContaining({ code: 'INVALID_COMPETITION_FEATURE_STATE' }),
    );
  });
});
