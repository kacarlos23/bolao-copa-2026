import { AppError } from '../../http/errors.js';
import {
  prepareConmebolCup2026,
  type ConmebolCup2026Definition,
} from '../conmebol/conmebol-cup-2026.service.js';
import type {
  NormalizedMatch,
  NormalizedResult,
  NormalizedStanding,
  NormalizedStructureEntity,
  NormalizedTeam,
  NormalizedTie,
  ProviderSnapshotEvidence,
} from '../providers/competition-data-provider.js';

export const COPA_DO_BRASIL_COMPETITION_SLUG = 'copa-do-brasil';
export const COPA_DO_BRASIL_2026_SEASON_SLUG = 'copa-do-brasil-2026';
export const COPA_DO_BRASIL_2026_POOL_SLUG = 'bolao-do-trabalho';
export const COPA_DO_BRASIL_2026_TIMEZONE = 'America/Sao_Paulo';
export const COPA_DO_BRASIL_2026_FIXTURE = 'cbf-copa-do-brasil-2026.sanitized.json';
export const COPA_DO_BRASIL_2026_SCOREABLE_FROM = new Date('2026-08-01T20:30:00.000Z');
export const COPA_DO_BRASIL_2026_PROVIDER = 'cbf-copa-do-brasil-official';

export function copaDoBrasil2026PredictionPolicy() {
  return {
    scoreableFromRound: 6,
    scoreableFrom: new Date(COPA_DO_BRASIL_2026_SCOREABLE_FROM.getTime()),
    startsAtRound: 6,
    historicalMatchesScoreable: false,
  } as const;
}

export interface CopaDoBrasil2026Readiness {
  teams: number;
  stages: number;
  rounds: number;
  ties: number;
  scheduledMatches: number;
  historicalResults: number;
  standings: number;
  decidedTies: number;
  scheduledTies: number;
  penalties: number;
  entryPhaseCounts: Record<string, number>;
  deferredBracketSlots: number;
  seasonStartsAt: Date;
}

function metadata(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function phaseOf(value: { providerMetadata?: Record<string, unknown> } | NormalizedTeam) {
  const phase = value.providerMetadata?.entryPhase;
  return typeof phase === 'number' ? phase : null;
}

export function assertCopaDoBrasil2026Readiness(input: {
  teams: NormalizedTeam[];
  structure: NormalizedStructureEntity[];
  ties: NormalizedTie[];
  schedule: NormalizedMatch[];
  results: NormalizedResult[];
  standings: NormalizedStanding[];
  evidence: ProviderSnapshotEvidence;
}): CopaDoBrasil2026Readiness {
  const stages = input.structure.filter((item) => item.kind === 'STAGE');
  const rounds = input.structure.filter((item) => item.kind === 'ROUND');
  const entryPhaseCounts = Object.fromEntries(
    [1, 2, 3, 4, 5].map((phase) => [
      String(phase),
      input.teams.filter((team) => phaseOf(team) === phase).length,
    ]),
  );
  const historicalResults = input.results.filter((result) => {
    const phase = metadata(result.providerMetadata).phase;
    return typeof phase === 'number' && phase <= 5;
  });
  const penalties = input.results.filter(
    (result) => result.penaltyHomeScore !== undefined && result.penaltyAwayScore !== undefined,
  );
  const phaseSixResults = input.results.filter(
    (result) => metadata(result.providerMetadata).phase === 6,
  );
  const seasonTimes = input.schedule
    .map((match) => (match.startsAt ? new Date(match.startsAt) : null))
    .filter((value): value is Date => value !== null && !Number.isNaN(value.getTime()));
  const artifactSources = input.evidence.artifacts.map((artifact) => artifact.source.toLowerCase());
  const requiredEvidence = [
    'rec_copa_do_brasil_2026',
    'pga_copa_do_brasil_2026',
    'tabela_basica_copa_do_brasil_2026',
    'tabela_detalhada_6_fase_copa_betano_do_brasil_2026',
  ];
  const invalid =
    input.teams.length !== 126 ||
    stages.length !== 1 ||
    rounds.length !== 9 ||
    input.ties.length !== 118 ||
    input.schedule.length !== 142 ||
    input.results.length !== 126 ||
    historicalResults.length !== 126 ||
    input.standings.length !== 0 ||
    input.ties.filter((tie) => tie.expectedLegs === 1).length !== 94 ||
    input.ties.filter((tie) => tie.expectedLegs === 2).length !== 24 ||
    input.ties.filter((tie) => tie.status === 'DECIDED').length !== 110 ||
    input.ties.filter((tie) => tie.status === 'SCHEDULED').length !== 8 ||
    input.schedule.filter((match) => match.roundExternalId === 'round:phase-6').length !== 16 ||
    phaseSixResults.length !== 0 ||
    entryPhaseCounts['1'] !== 28 ||
    entryPhaseCounts['2'] !== 74 ||
    entryPhaseCounts['3'] !== 4 ||
    entryPhaseCounts['4'] !== 0 ||
    entryPhaseCounts['5'] !== 20 ||
    seasonTimes.length !== input.schedule.length ||
    input.evidence.collectionTimezone !== COPA_DO_BRASIL_2026_TIMEZONE ||
    input.evidence.sourceOffset !== '-03:00' ||
    requiredEvidence.some(
      (fragment) => !artifactSources.some((source) => source.includes(fragment)),
    ) ||
    input.schedule.some(
      (match) =>
        !match.homeTeamExternalId ||
        !match.awayTeamExternalId ||
        !match.tieExternalId ||
        match.homeTeamName === 'A definir' ||
        match.awayTeamName === 'A definir',
    );
  if (invalid) {
    throw new AppError(
      409,
      'A fotografia oficial da CBF não satisfaz os gates da Copa do Brasil 2026.',
      'CBF_COPA_DO_BRASIL_SOURCE_INCOMPLETE',
    );
  }
  return {
    teams: input.teams.length,
    stages: stages.length,
    rounds: rounds.length,
    ties: input.ties.length,
    scheduledMatches: input.schedule.length,
    historicalResults: historicalResults.length,
    standings: input.standings.length,
    decidedTies: input.ties.filter((tie) => tie.status === 'DECIDED').length,
    scheduledTies: input.ties.filter((tie) => tie.status === 'SCHEDULED').length,
    penalties: penalties.length,
    entryPhaseCounts,
    deferredBracketSlots: 7,
    seasonStartsAt: new Date(Math.min(...seasonTimes.map((value) => value.getTime()))),
  };
}

const definition: ConmebolCup2026Definition = {
  competitionSlug: COPA_DO_BRASIL_COMPETITION_SLUG,
  seasonSlug: COPA_DO_BRASIL_2026_SEASON_SLUG,
  poolSlug: COPA_DO_BRASIL_2026_POOL_SLUG,
  competitionName: 'Copa do Brasil',
  seasonName: 'Copa do Brasil 2026',
  presentation: {
    label: 'COPA NACIONAL',
    theme: {
      accent: '#72b7f2',
      accentInk: '#071b2e',
      surface: '#123756',
      glow: 'rgba(114, 183, 242, .20)',
    },
  },
  fixtureName: COPA_DO_BRASIL_2026_FIXTURE,
  collectionStrategy: 'IMMUTABLE_FIXTURE',
  providerKey: COPA_DO_BRASIL_2026_PROVIDER,
  providerProvenance: 'prompt-6-copa-do-brasil-2026-cbf-official-snapshot',
  policyVersion: 'copa-do-brasil-2026-15-3-1-0-v1',
  featureReason:
    'Canário administrativo da Copa do Brasil 2026; UI, escrita e sync público desligados.',
  timezone: COPA_DO_BRASIL_2026_TIMEZONE,
  scoreableFrom: COPA_DO_BRASIL_2026_SCOREABLE_FROM,
  predictionPolicy: { scoreableFromRound: 6, startsAtRound: 6 },
  providerEnabledTypes: ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS'],
  cutoffBasis:
    'Primeiro jogo futuro homologado da sexta fase: Vasco da Gama x Fluminense, 01/08/2026 às 17h30 de Brasília, Maracanã.',
  cutoffRequiresOfficialKickoffRevalidation: false,
  competitionCapabilities: {
    format: 'KNOCKOUT',
    knockout: true,
    twoLegs: true,
    liveScoring: true,
    standings: false,
    rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
  },
  seasonCapabilities: {
    format: 'KNOCKOUT',
    knockout: true,
    twoLegs: true,
    liveScoring: true,
    standings: false,
    rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
  },
  providerSettings: {
    collectionStrategy: 'IMMUTABLE_FIXTURE',
    fallbackProviders: ['manual'],
  },
};

export function prepareCopaDoBrasil2026(input: {
  readiness: CopaDoBrasil2026Readiness;
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
