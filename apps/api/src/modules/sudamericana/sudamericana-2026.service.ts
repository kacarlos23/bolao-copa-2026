import { AppError } from '../../http/errors.js';
import {
  prepareConmebolCup2026,
  type ConmebolCup2026Definition,
} from '../conmebol/conmebol-cup-2026.service.js';
import type {
  NormalizedMatch,
  NormalizedStanding,
  NormalizedStructureEntity,
  NormalizedTeam,
  NormalizedTie,
  ProviderSnapshotEvidence,
} from '../providers/competition-data-provider.js';

export const SUDAMERICANA_COMPETITION_SLUG = 'conmebol-sudamericana';
export const SUDAMERICANA_2026_SEASON_SLUG = 'conmebol-sudamericana-2026';
export const SUDAMERICANA_2026_POOL_SLUG = 'bolao-do-trabalho';
export const SUDAMERICANA_2026_TIMEZONE = 'America/Sao_Paulo';
export const SUDAMERICANA_2026_FIXTURE = 'conmebol-sudamericana-2026.sanitized.json';
export const SUDAMERICANA_2026_SCOREABLE_FROM = new Date('2026-08-12T12:00:00.000Z');

export function sudamericana2026PredictionPolicy() {
  return {
    scoreableFromRound: null,
    scoreableFrom: new Date(SUDAMERICANA_2026_SCOREABLE_FROM.getTime()),
    startsAtRound: null,
    historicalMatchesScoreable: false,
  } as const;
}

export interface Sudamericana2026Readiness {
  teams: number;
  stages: number;
  groupRounds: number;
  ties: number;
  scheduledMatches: number;
  historicalResults: number;
  standings: number;
  libertadoresTransfers: number;
  excludedTbcPlaceholders: number;
  seasonStartsAt: Date;
}

export function assertSudamericana2026Readiness(input: {
  teams: NormalizedTeam[];
  structure: NormalizedStructureEntity[];
  ties: NormalizedTie[];
  schedule: NormalizedMatch[];
  results: Array<{ externalId: string }>;
  standings: NormalizedStanding[];
  evidence: ProviderSnapshotEvidence;
}): Sudamericana2026Readiness {
  const stages = input.structure.filter((item) => item.kind === 'STAGE');
  const groupRounds = input.structure.filter(
    (item) => item.kind === 'ROUND' && item.stageExternalId === 'stage:groups',
  );
  const groupNames = new Set(input.standings.map((standing) => standing.groupName));
  const transferred = input.teams.filter(
    (team) => team.providerMetadata?.entryRoute === 'LIBERTADORES_GROUP_THIRD',
  );
  const unknown = input.teams.filter((team) => team.name === 'Unknown');
  const seasonTimes = input.schedule
    .map((match) => (match.startsAt ? new Date(match.startsAt) : null))
    .filter((value): value is Date => Boolean(value) && !Number.isNaN(value!.getTime()));
  const artifactSources = input.evidence.artifacts.map((artifact) => artifact.source);
  const requiredEvidence = [
    'Manual-de-Clubes',
    'tournament-fixtures/104',
    'tournament-table/104',
    'playoffs',
    'octavos-de-final',
  ];
  const invalid =
    input.teams.length !== 56 ||
    stages.length !== 3 ||
    groupRounds.length !== 6 ||
    input.ties.length !== 24 ||
    input.schedule.length !== 128 ||
    input.results.length < 112 ||
    input.standings.length !== 32 ||
    groupNames.size !== 8 ||
    transferred.length !== 8 ||
    unknown.length !== 0 ||
    seasonTimes.length !== input.schedule.length ||
    input.evidence.collectionTimezone !== SUDAMERICANA_2026_TIMEZONE ||
    input.evidence.sourceOffset !== '-03:00' ||
    requiredEvidence.some(
      (fragment) =>
        !artifactSources.some((source) => source.toLowerCase().includes(fragment.toLowerCase())),
    );
  if (invalid) {
    throw new AppError(
      409,
      'A fotografia oficial da CONMEBOL não satisfaz os gates da Sul-Americana 2026.',
      'SUDAMERICANA_SOURCE_INCOMPLETE',
    );
  }
  return {
    teams: input.teams.length,
    stages: stages.length,
    groupRounds: groupRounds.length,
    ties: input.ties.length,
    scheduledMatches: input.schedule.length,
    historicalResults: input.results.length,
    standings: input.standings.length,
    libertadoresTransfers: transferred.length,
    excludedTbcPlaceholders: 16,
    seasonStartsAt: new Date(Math.min(...seasonTimes.map((value) => value.getTime()))),
  };
}

const definition: ConmebolCup2026Definition = {
  competitionSlug: SUDAMERICANA_COMPETITION_SLUG,
  seasonSlug: SUDAMERICANA_2026_SEASON_SLUG,
  poolSlug: SUDAMERICANA_2026_POOL_SLUG,
  competitionName: 'CONMEBOL Sul-Americana',
  seasonName: 'CONMEBOL Sul-Americana 2026',
  fixtureName: SUDAMERICANA_2026_FIXTURE,
  collectionStrategy: 'LIVE_SUDAMERICANA_2026',
  providerProvenance: 'prompt-4-sudamericana-2026-official-snapshot',
  policyVersion: 'sudamericana-2026-15-3-1-0-v1',
  featureReason: 'Canário administrativo da CONMEBOL Sul-Americana 2026.',
  timezone: SUDAMERICANA_2026_TIMEZONE,
  scoreableFrom: SUDAMERICANA_2026_SCOREABLE_FROM,
  cutoffBasis:
    'Primeiro slot futuro oficial das oitavas; horário TBC exige nova homologação antes de liberar escrita.',
  cutoffRequiresOfficialKickoffRevalidation: true,
  seasonCapabilities: {
    groups: 8,
    groupRounds: 6,
    historicalPreliminary: true,
    twoLegsThroughSemifinal: true,
    finalSingleMatch: true,
  },
};

export function prepareSudamericana2026(input: {
  readiness: Sudamericana2026Readiness;
  evidence: ProviderSnapshotEvidence;
  actorId?: string | null;
}) {
  return prepareConmebolCup2026({
    definition,
    seasonStartsAt: input.readiness.seasonStartsAt,
    evidence: input.evidence,
    actorId: input.actorId,
  });
}
