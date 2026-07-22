import { Prisma } from '@prisma/client';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import type {
  NormalizedMatch,
  NormalizedStanding,
  NormalizedStructureEntity,
  NormalizedTeam,
  NormalizedTie,
  ProviderSnapshotEvidence,
} from '../providers/competition-data-provider.js';
import { checksum } from '../providers/provider-utils.js';
import {
  INITIAL_SCORING_VERSION_ID,
  INITIAL_TIE_BREAKER_ID,
} from '../scoring/scoring-rules.service.js';

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

function providerMapping(input: {
  entityType: 'COMPETITION' | 'COMPETITION_SEASON';
  externalId: string;
  internalId: string;
  seasonId?: string;
  evidence: ProviderSnapshotEvidence;
}) {
  return {
    provider: 'conmebol-official',
    scopeKey: input.seasonId ? `season:${input.seasonId}` : 'global',
    entityType: input.entityType,
    externalId: input.externalId,
    internalId: input.internalId,
    seasonId: input.seasonId,
    sourceUrl: input.evidence.source,
    collectedAt: new Date(input.evidence.collectedAt),
    checksum: checksum({
      externalId: input.externalId,
      sourceChecksum: input.evidence.checksum,
    }),
    metadata: {
      snapshotChecksum: input.evidence.checksum,
      collectionTimezone: input.evidence.collectionTimezone,
      sourceOffset: input.evidence.sourceOffset,
    },
  } satisfies Prisma.ProviderEntityMappingUncheckedCreateInput;
}

export async function prepareSudamericana2026(input: {
  readiness: Sudamericana2026Readiness;
  evidence: ProviderSnapshotEvidence;
  actorId?: string | null;
}) {
  const sourceEvidence = JSON.parse(JSON.stringify(input.evidence)) as Prisma.InputJsonValue;
  const result = await prisma.$transaction(async (tx) => {
    const competition = await tx.competition.upsert({
      where: { slug: SUDAMERICANA_COMPETITION_SLUG },
      create: {
        slug: SUDAMERICANA_COMPETITION_SLUG,
        name: 'CONMEBOL Sul-Americana',
        capabilities: {
          format: 'GROUPS_KNOCKOUT',
          capabilityList: ['GROUPS', 'KNOCKOUT', 'TWO_LEGS', 'STANDINGS', 'LIVE_SCORING'],
          groups: true,
          knockout: true,
          twoLegs: true,
          standings: true,
          liveScoring: true,
          rankingScopes: ['OVERALL', 'ROUND'],
        },
        metadata: { source: sourceEvidence },
      },
      update: {
        name: 'CONMEBOL Sul-Americana',
        capabilities: {
          format: 'GROUPS_KNOCKOUT',
          capabilityList: ['GROUPS', 'KNOCKOUT', 'TWO_LEGS', 'STANDINGS', 'LIVE_SCORING'],
          groups: true,
          knockout: true,
          twoLegs: true,
          standings: true,
          liveScoring: true,
          rankingScopes: ['OVERALL', 'ROUND'],
        },
        metadata: { source: sourceEvidence },
      },
    });
    const season = await tx.competitionSeason.upsert({
      where: {
        competitionId_slug: {
          competitionId: competition.id,
          slug: SUDAMERICANA_2026_SEASON_SLUG,
        },
      },
      create: {
        competitionId: competition.id,
        slug: SUDAMERICANA_2026_SEASON_SLUG,
        name: 'CONMEBOL Sul-Americana 2026',
        year: 2026,
        timezone: SUDAMERICANA_2026_TIMEZONE,
        status: 'DRAFT',
        startsAt: input.readiness.seasonStartsAt,
        capabilities: {
          groups: 8,
          groupRounds: 6,
          historicalPreliminary: true,
          twoLegsThroughSemifinal: true,
          finalSingleMatch: true,
        },
        metadata: {
          source: sourceEvidence,
          publicExposureRecommended: false,
          cutoff: {
            scoreableFrom: SUDAMERICANA_2026_SCOREABLE_FROM.toISOString(),
            historicalMatchesScoreable: false,
            basis:
              'Primeiro slot futuro oficial das oitavas; horário TBC exige nova homologação antes de liberar escrita.',
          },
        },
      },
      update: {
        name: 'CONMEBOL Sul-Americana 2026',
        year: 2026,
        timezone: SUDAMERICANA_2026_TIMEZONE,
        status: 'DRAFT',
        startsAt: input.readiness.seasonStartsAt,
        capabilities: {
          groups: 8,
          groupRounds: 6,
          historicalPreliminary: true,
          twoLegsThroughSemifinal: true,
          finalSingleMatch: true,
        },
        metadata: {
          source: sourceEvidence,
          publicExposureRecommended: false,
          cutoff: {
            scoreableFrom: SUDAMERICANA_2026_SCOREABLE_FROM.toISOString(),
            historicalMatchesScoreable: false,
            basis:
              'Primeiro slot futuro oficial das oitavas; horário TBC exige nova homologação antes de liberar escrita.',
          },
        },
      },
    });
    await tx.seasonProviderConfig.upsert({
      where: {
        seasonId_providerKey: { seasonId: season.id, providerKey: 'conmebol-official' },
      },
      create: {
        seasonId: season.id,
        providerKey: 'conmebol-official',
        priority: 1,
        enabledTypes: ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS'],
        cadenceSeconds: 300,
        timeoutMs: 20_000,
        active: true,
        includeProfiles: false,
        source: input.evidence.source,
        provenance: 'prompt-4-sudamericana-2026-official-snapshot',
        settings: {
          competition: SUDAMERICANA_COMPETITION_SLUG,
          fixtureName: SUDAMERICANA_2026_FIXTURE,
          collectionStrategy: 'LIVE_SUDAMERICANA_2026',
          fallbackProviders: ['manual'],
          automaticSyncControlledByFeatureFlag: true,
        },
      },
      update: {
        priority: 1,
        enabledTypes: ['TEAMS', 'STRUCTURE', 'TIES', 'SCHEDULE', 'RESULTS', 'STANDINGS'],
        cadenceSeconds: 300,
        timeoutMs: 20_000,
        active: true,
        includeProfiles: false,
        source: input.evidence.source,
        provenance: 'prompt-4-sudamericana-2026-official-snapshot',
        settings: {
          competition: SUDAMERICANA_COMPETITION_SLUG,
          fixtureName: SUDAMERICANA_2026_FIXTURE,
          collectionStrategy: 'LIVE_SUDAMERICANA_2026',
          fallbackProviders: ['manual'],
          automaticSyncControlledByFeatureFlag: true,
        },
      },
    });
    const scoringRuleSet = await tx.scoringRuleSet.upsert({
      where: { key_version: { key: SUDAMERICANA_COMPETITION_SLUG, version: 1 } },
      create: {
        key: SUDAMERICANA_COMPETITION_SLUG,
        name: 'Bolão CONMEBOL Sul-Americana',
        version: 1,
        rules: { exactScore: 15, outcome: 3, oneTeamGoals: 1, miss: 0 },
        tieBreakers: ['points', 'exactScores', 'resultHits', 'oneGoalHits', 'fewerMisses', 'name'],
        effectiveAt: SUDAMERICANA_2026_SCOREABLE_FROM,
        metadata: {
          immutableVersionId: INITIAL_SCORING_VERSION_ID,
          policyVersion: 'sudamericana-2026-15-3-1-0-v1',
        },
      },
      update: {
        name: 'Bolão CONMEBOL Sul-Americana',
        rules: { exactScore: 15, outcome: 3, oneTeamGoals: 1, miss: 0 },
        tieBreakers: ['points', 'exactScores', 'resultHits', 'oneGoalHits', 'fewerMisses', 'name'],
        effectiveAt: SUDAMERICANA_2026_SCOREABLE_FROM,
        metadata: {
          immutableVersionId: INITIAL_SCORING_VERSION_ID,
          policyVersion: 'sudamericana-2026-15-3-1-0-v1',
        },
      },
    });
    const pool = await tx.pool.upsert({
      where: { slug: SUDAMERICANA_2026_POOL_SLUG },
      create: {
        slug: SUDAMERICANA_2026_POOL_SLUG,
        name: 'Bolão do Trabalho',
        isPublic: false,
      },
      update: {},
    });
    const poolSeason = await tx.poolSeason.upsert({
      where: { poolId_seasonId: { poolId: pool.id, seasonId: season.id } },
      create: {
        poolId: pool.id,
        seasonId: season.id,
        scoringRuleSetId: scoringRuleSet.id,
        scoringRuleSetVersionId: INITIAL_SCORING_VERSION_ID,
        tieBreakerRuleSetId: INITIAL_TIE_BREAKER_ID,
        ...sudamericana2026PredictionPolicy(),
        metadata: {
          policyVersion: 'sudamericana-2026-15-3-1-0-v1',
          canary: true,
          cutoffRequiresOfficialKickoffRevalidation: true,
        },
      },
      update: {
        scoringRuleSetId: scoringRuleSet.id,
        scoringRuleSetVersionId: INITIAL_SCORING_VERSION_ID,
        tieBreakerRuleSetId: INITIAL_TIE_BREAKER_ID,
        ...sudamericana2026PredictionPolicy(),
        metadata: {
          policyVersion: 'sudamericana-2026-15-3-1-0-v1',
          canary: true,
          cutoffRequiresOfficialKickoffRevalidation: true,
        },
      },
    });

    for (const entry of [
      providerMapping({
        entityType: 'COMPETITION',
        externalId: `competition:${SUDAMERICANA_COMPETITION_SLUG}`,
        internalId: competition.id,
        evidence: input.evidence,
      }),
      providerMapping({
        entityType: 'COMPETITION_SEASON',
        externalId: `season:${SUDAMERICANA_2026_SEASON_SLUG}`,
        internalId: season.id,
        seasonId: season.id,
        evidence: input.evidence,
      }),
    ]) {
      await tx.providerEntityMapping.upsert({
        where: {
          provider_entityType_externalId: {
            provider: entry.provider,
            entityType: entry.entityType,
            externalId: entry.externalId,
          },
        },
        create: entry,
        update: {
          internalId: entry.internalId,
          seasonId: entry.seasonId,
          sourceUrl: entry.sourceUrl,
          collectedAt: entry.collectedAt,
          checksum: entry.checksum,
          metadata: entry.metadata,
        },
      });
    }

    const flags = {
      readEnabled: false,
      writeEnabled: false,
      uiEnabled: false,
      syncEnabled: false,
      reason: 'Canário administrativo da CONMEBOL Sul-Americana 2026.',
      updatedAt: new Date().toISOString(),
      updatedById: input.actorId ?? null,
    };
    await tx.appSetting.upsert({
      where: { key: `competition-features:${season.id}` },
      create: { key: `competition-features:${season.id}`, value: flags },
      update: { value: flags },
    });
    if (input.actorId) {
      await tx.adminAuditLog.create({
        data: {
          actorId: input.actorId,
          action: 'MANUAL_SYNC',
          targetId: season.id,
          details: {
            operation: 'prepare-sudamericana-2026',
            source: input.evidence.source,
            checksum: input.evidence.checksum,
          },
        },
      });
    }
    const event = await enqueueOutboxEvent(tx, {
      type: 'competition.season.prepared',
      seasonId: season.id,
      poolSeasonId: poolSeason.id,
      payload: {
        competitionId: competition.id,
        sourceChecksum: input.evidence.checksum,
        scoreableFrom: SUDAMERICANA_2026_SCOREABLE_FROM.toISOString(),
        historicalMatchesScoreable: false,
      },
    });
    return { competition, season, pool, poolSeason, eventId: event.id };
  });
  await dispatchOutboxEvent(result.eventId);
  return result;
}
