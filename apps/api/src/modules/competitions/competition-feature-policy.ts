import type { CompetitionSeasonStatus } from '@prisma/client';
import { AppError } from '../../http/errors.js';
import type { CompetitionFeatureFlags } from './competition-feature.service.js';

export type CompetitionFeatureSwitches = Pick<
  CompetitionFeatureFlags,
  'readEnabled' | 'writeEnabled' | 'uiEnabled' | 'syncEnabled'
>;

export type CompetitionFeatureState =
  | 'CLOSED'
  | 'BACKSTAGE_SYNC'
  | 'READ_ONLY'
  | 'READ_AND_SYNC'
  | 'PUBLIC'
  | 'PUBLIC_AND_SYNC'
  | 'RESTORED_DRAFT';

function allDisabled(flags: CompetitionFeatureSwitches) {
  return !flags.readEnabled && !flags.writeEnabled && !flags.uiEnabled && !flags.syncEnabled;
}

function restoredDraft(flags: CompetitionFeatureSwitches) {
  return flags.readEnabled && flags.writeEnabled && flags.uiEnabled;
}

export function classifyCompetitionFeatureState(
  status: CompetitionSeasonStatus,
  flags: CompetitionFeatureSwitches,
): CompetitionFeatureState | null {
  if (allDisabled(flags)) return 'CLOSED';

  if (status === 'DRAFT') {
    if (!flags.readEnabled && !flags.writeEnabled && !flags.uiEnabled && flags.syncEnabled) {
      return 'BACKSTAGE_SYNC';
    }
    // This explicitly preserves the restored Brasileirao state without selecting
    // behavior by slug. Any change away from it still requires an audited mutation.
    if (restoredDraft(flags)) return 'RESTORED_DRAFT';
    return null;
  }

  if (flags.writeEnabled && !flags.readEnabled) return null;
  if (flags.uiEnabled && !flags.readEnabled) return null;
  if (['FINISHED', 'ARCHIVED'].includes(status) && (flags.writeEnabled || flags.syncEnabled)) {
    return null;
  }

  if (!flags.readEnabled && flags.syncEnabled) return 'BACKSTAGE_SYNC';
  if (flags.readEnabled && !flags.writeEnabled && !flags.uiEnabled && !flags.syncEnabled) {
    return 'READ_ONLY';
  }
  if (flags.readEnabled && !flags.writeEnabled && !flags.uiEnabled && flags.syncEnabled) {
    return 'READ_AND_SYNC';
  }
  if (flags.readEnabled && !flags.syncEnabled) return 'PUBLIC';
  if (flags.readEnabled && flags.syncEnabled) return 'PUBLIC_AND_SYNC';
  return null;
}

export function assertCompetitionFeatureState(
  status: CompetitionSeasonStatus,
  flags: CompetitionFeatureSwitches,
) {
  const state = classifyCompetitionFeatureState(status, flags);
  if (!state) {
    throw new AppError(
      409,
      'A combinação entre status da temporada e feature flags não é permitida.',
      'INVALID_COMPETITION_FEATURE_STATE',
    );
  }
  return state;
}
