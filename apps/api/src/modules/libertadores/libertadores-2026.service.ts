import { Prisma } from '@prisma/client';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
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
import { SUDAMERICANA_2026_SEASON_SLUG } from '../sudamericana/sudamericana-2026.service.js';
import { buildCupAchievementDefinitions } from '../engagement/competition-achievements.js';

export const LIBERTADORES_COMPETITION_SLUG = 'conmebol-libertadores';
export const LIBERTADORES_2026_SEASON_SLUG = 'conmebol-libertadores-2026';
export const LIBERTADORES_2026_POOL_SLUG = 'bolao-do-trabalho';
export const LIBERTADORES_2026_TIMEZONE = 'America/Sao_Paulo';
export const LIBERTADORES_2026_FIXTURE = 'conmebol-libertadores-2026.sanitized.json';
export const LIBERTADORES_2026_SCOREABLE_FROM = new Date('2026-08-11T22:00:00.000Z');
export const LIBERTADORES_TRANSFER_ROUTE = 'LIBERTADORES_GROUP_THIRD_TO_SUDAMERICANA_PLAYOFFS';

export function libertadores2026PredictionPolicy() {
  return {
    scoreableFromRound: null,
    scoreableFrom: new Date(LIBERTADORES_2026_SCOREABLE_FROM.getTime()),
    startsAtRound: null,
    historicalMatchesScoreable: false,
  } as const;
}

export interface Libertadores2026Readiness {
  teams: number;
  stages: number;
  preliminaryRounds: number;
  groupRounds: number;
  finalRounds: number;
  ties: number;
  preliminaryTies: number;
  roundOf16Ties: number;
  scheduledMatches: number;
  historicalResults: number;
  standings: number;
  qualified: number;
  sudamericanaTransfers: number;
  deferredBracketSlots: number;
  seasonStartsAt: Date;
}

export function assertLibertadores2026Readiness(input: {
  teams: NormalizedTeam[];
  structure: NormalizedStructureEntity[];
  ties: NormalizedTie[];
  schedule: NormalizedMatch[];
  results: Array<{ externalId: string }>;
  standings: NormalizedStanding[];
  evidence: ProviderSnapshotEvidence;
}): Libertadores2026Readiness {
  const stages = input.structure.filter((item) => item.kind === 'STAGE');
  const rounds = input.structure.filter((item) => item.kind === 'ROUND');
  const preliminaryRounds = rounds.filter(
    (item) => item.kind === 'ROUND' && item.stageExternalId === 'stage:preliminary',
  );
  const groupRounds = rounds.filter(
    (item) => item.kind === 'ROUND' && item.stageExternalId === 'stage:groups',
  );
  const finalRounds = rounds.filter(
    (item) => item.kind === 'ROUND' && item.stageExternalId === 'stage:finals',
  );
  const preliminaryTies = input.ties.filter((tie) => tie.stageExternalId === 'stage:preliminary');
  const roundOf16Ties = input.ties.filter((tie) => tie.roundExternalId === 'round:round-of-16');
  const qualified = input.standings.filter((standing) => standing.qualification === 'QUALIFIED');
  const transferred = input.standings.filter(
    (standing) => standing.position === 3 && standing.qualification === 'TRANSFERRED',
  );
  const groupNames = new Set(input.standings.map((standing) => standing.groupName));
  const seasonTimes = input.schedule
    .map((match) => (match.startsAt ? new Date(match.startsAt) : null))
    .filter((value): value is Date => Boolean(value) && !Number.isNaN(value!.getTime()));
  const artifactSources = input.evidence.artifacts.map((artifact) => artifact.source.toLowerCase());
  const requiredEvidence = [
    'manual-de-clubes',
    'tournament-fixtures/15',
    'tournament-table/15',
    'protagonistas-para-octavos',
    'fechas-y-horarios',
    'fixture_8vos-de-final',
  ];
  const invalid =
    input.teams.length !== 47 ||
    stages.length !== 3 ||
    preliminaryRounds.length !== 3 ||
    groupRounds.length !== 6 ||
    finalRounds.length !== 4 ||
    input.ties.length !== 23 ||
    preliminaryTies.length !== 15 ||
    roundOf16Ties.length !== 8 ||
    input.schedule.length !== 142 ||
    input.results.length !== 126 ||
    input.standings.length !== 32 ||
    qualified.length !== 16 ||
    transferred.length !== 8 ||
    groupNames.size !== 8 ||
    seasonTimes.length !== input.schedule.length ||
    input.schedule.filter((match) => match.roundExternalId === 'round:round-of-16').length !== 16 ||
    input.schedule
      .filter((match) => match.roundExternalId === 'round:round-of-16')
      .some((match) => !match.kickoffConfirmed || !match.venue?.name) ||
    input.evidence.collectionTimezone !== LIBERTADORES_2026_TIMEZONE ||
    input.evidence.sourceOffset !== '-03:00' ||
    requiredEvidence.some(
      (fragment) => !artifactSources.some((source) => source.includes(fragment.toLowerCase())),
    );
  if (invalid) {
    throw new AppError(
      409,
      'A fotografia oficial da CONMEBOL não satisfaz os gates da Libertadores 2026.',
      'LIBERTADORES_SOURCE_INCOMPLETE',
    );
  }
  return {
    teams: input.teams.length,
    stages: stages.length,
    preliminaryRounds: preliminaryRounds.length,
    groupRounds: groupRounds.length,
    finalRounds: finalRounds.length,
    ties: input.ties.length,
    preliminaryTies: preliminaryTies.length,
    roundOf16Ties: roundOf16Ties.length,
    scheduledMatches: input.schedule.length,
    historicalResults: input.results.length,
    standings: input.standings.length,
    qualified: qualified.length,
    sudamericanaTransfers: transferred.length,
    deferredBracketSlots: 7,
    seasonStartsAt: new Date(Math.min(...seasonTimes.map((value) => value.getTime()))),
  };
}

interface TransferMapping {
  seasonId: string;
  internalId: string;
  rawExternalId: string;
}

export function assertGlobalTransferIdentity(input: {
  sourceSeasonId: string;
  targetSeasonId: string;
  transferredExternalIds: string[];
  mappings: TransferMapping[];
}) {
  const links = input.transferredExternalIds.map((rawExternalId) => {
    const source = input.mappings.filter(
      (mapping) =>
        mapping.seasonId === input.sourceSeasonId && mapping.rawExternalId === rawExternalId,
    );
    const target = input.mappings.filter(
      (mapping) =>
        mapping.seasonId === input.targetSeasonId && mapping.rawExternalId === rawExternalId,
    );
    if (
      source.length !== 1 ||
      target.length !== 1 ||
      source[0].internalId !== target[0].internalId
    ) {
      throw new AppError(
        409,
        `O clube transferido ${rawExternalId} não preservou uma identidade Team global única.`,
        'CONMEBOL_TRANSFER_IDENTITY_MISMATCH',
      );
    }
    return { rawExternalId, teamId: source[0].internalId };
  });
  if (new Set(links.map((link) => link.teamId)).size !== input.transferredExternalIds.length) {
    throw new AppError(
      409,
      'Dois terceiros colocados foram reconciliados no mesmo Team global.',
      'CONMEBOL_TRANSFER_TEAM_COLLISION',
    );
  }
  return links;
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

export async function linkLibertadoresThirdPlacedTransfers(input: {
  standings: NormalizedStanding[];
  evidence: ProviderSnapshotEvidence;
  apply?: boolean;
}) {
  const transferred = input.standings.filter(
    (standing) =>
      standing.position === 3 &&
      standing.qualification === 'TRANSFERRED' &&
      standing.teamExternalId,
  );
  if (transferred.length !== 8) {
    throw new AppError(
      409,
      'A classificação oficial não contém oito terceiros exportáveis.',
      'LIBERTADORES_TRANSFER_COUNT_INVALID',
    );
  }
  const seasons = await prisma.competitionSeason.findMany({
    where: { slug: { in: [LIBERTADORES_2026_SEASON_SLUG, SUDAMERICANA_2026_SEASON_SLUG] } },
    select: { id: true, slug: true },
  });
  const sourceSeason = seasons.find((season) => season.slug === LIBERTADORES_2026_SEASON_SLUG);
  const targetSeason = seasons.find((season) => season.slug === SUDAMERICANA_2026_SEASON_SLUG);
  if (!sourceSeason || !targetSeason) {
    throw new AppError(
      409,
      'As temporadas CONMEBOL precisam existir antes de vincular a transferência.',
      'CONMEBOL_TRANSFER_SEASON_MISSING',
    );
  }
  const transferredExternalIds = transferred.map((standing) => standing.teamExternalId!);
  const mappings = await prisma.providerEntityMapping.findMany({
    where: {
      provider: 'conmebol-official',
      entityType: 'TEAM',
      seasonId: { in: [sourceSeason.id, targetSeason.id] },
      metadata: { path: ['rawExternalId'], string_contains: '' },
    },
    select: { id: true, seasonId: true, internalId: true, metadata: true },
  });
  const normalizedMappings = mappings.flatMap((mapping) => {
    const rawExternalId = jsonObject(mapping.metadata).rawExternalId;
    return typeof rawExternalId === 'string'
      ? [{ seasonId: mapping.seasonId!, internalId: mapping.internalId, rawExternalId }]
      : [];
  });
  const links = assertGlobalTransferIdentity({
    sourceSeasonId: sourceSeason.id,
    targetSeasonId: targetSeason.id,
    transferredExternalIds,
    mappings: normalizedMappings,
  });
  const seasonTeams = await prisma.seasonTeam.findMany({
    where: {
      seasonId: { in: [sourceSeason.id, targetSeason.id] },
      teamId: { in: links.map((link) => link.teamId) },
    },
    select: { id: true, seasonId: true, teamId: true, metadata: true },
  });
  if (seasonTeams.length !== 16) {
    throw new AppError(
      409,
      'Os terceiros colocados não pertencem explicitamente às duas temporadas.',
      'CONMEBOL_TRANSFER_SEASON_TEAM_MISSING',
    );
  }

  const expectedExistingLinks = input.apply === false;
  if (
    expectedExistingLinks &&
    (seasonTeams.filter(
      (entry) =>
        jsonObject(entry.metadata).qualificationTransfer &&
        jsonObject(jsonObject(entry.metadata).qualificationTransfer as Prisma.JsonValue).route ===
          LIBERTADORES_TRANSFER_ROUTE,
    ).length !== 16 ||
      mappings.filter(
        (entry) =>
          jsonObject(entry.metadata).qualificationTransfer &&
          jsonObject(jsonObject(entry.metadata).qualificationTransfer as Prisma.JsonValue).route ===
            LIBERTADORES_TRANSFER_ROUTE,
      ).length < 16)
  ) {
    throw new AppError(
      409,
      'O vínculo bilateral dos terceiros colocados ainda não foi aplicado.',
      'CONMEBOL_TRANSFER_LINK_MISSING',
    );
  }

  if (input.apply !== false)
    await prisma.$transaction(async (tx) => {
      for (const link of links) {
        const standing = transferred.find((row) => row.teamExternalId === link.rawExternalId)!;
        const qualificationTransfer = {
          route: LIBERTADORES_TRANSFER_ROUTE,
          status: 'CONFIRMED',
          sourceSeasonId: sourceSeason.id,
          targetSeasonId: targetSeason.id,
          sourceGroup: standing.groupName,
          sourcePosition: 3,
          sourceChecksum: input.evidence.checksum,
          collectedAt: input.evidence.collectedAt,
        };
        for (const seasonTeam of seasonTeams.filter((entry) => entry.teamId === link.teamId)) {
          await tx.seasonTeam.update({
            where: { id: seasonTeam.id },
            data: {
              metadata: {
                ...jsonObject(seasonTeam.metadata),
                qualificationTransfer,
              } as Prisma.InputJsonValue,
            },
          });
        }
        for (const mapping of mappings.filter((entry) => entry.internalId === link.teamId)) {
          await tx.providerEntityMapping.update({
            where: { id: mapping.id },
            data: {
              metadata: {
                ...jsonObject(mapping.metadata),
                qualificationTransfer,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
    });
  return {
    sourceSeasonId: sourceSeason.id,
    targetSeasonId: targetSeason.id,
    route: LIBERTADORES_TRANSFER_ROUTE,
    linkedTeams: links.length,
    links,
  };
}

const definition: ConmebolCup2026Definition = {
  competitionSlug: LIBERTADORES_COMPETITION_SLUG,
  seasonSlug: LIBERTADORES_2026_SEASON_SLUG,
  poolSlug: LIBERTADORES_2026_POOL_SLUG,
  competitionName: 'CONMEBOL Libertadores',
  seasonName: 'CONMEBOL Libertadores 2026',
  presentation: {
    label: 'CONMEBOL',
    theme: {
      accent: '#f4d65c',
      accentInk: '#201c08',
      surface: '#473b18',
      glow: 'rgba(244, 214, 92, .18)',
    },
  },
  fixtureName: LIBERTADORES_2026_FIXTURE,
  collectionStrategy: 'LIVE_LIBERTADORES_2026',
  providerProvenance: 'prompt-5-libertadores-2026-official-snapshot',
  policyVersion: 'libertadores-2026-15-3-1-0-v1',
  featureReason: 'Canário administrativo da CONMEBOL Libertadores 2026.',
  timezone: LIBERTADORES_2026_TIMEZONE,
  scoreableFrom: LIBERTADORES_2026_SCOREABLE_FROM,
  cutoffBasis:
    'Primeiro jogo das oitavas integralmente confirmado: Fluminense x Independiente Rivadavia, 11/08/2026 às 19h locais, Maracanã.',
  cutoffRequiresOfficialKickoffRevalidation: false,
  seasonCapabilities: {
    format: 'GROUPS',
    groupStage: true,
    standings: true,
    knockout: true,
    twoLegs: true,
    rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
  },
  achievementDefinitions: buildCupAchievementDefinitions({
    keyPrefix: 'LIBERTADORES_2026',
    includeGroupStage: true,
    finalRoundOrder: 4,
    championName: 'Campeão da Libertadores no Bolão',
  }),
};

export function prepareLibertadores2026(input: {
  readiness: Libertadores2026Readiness;
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
