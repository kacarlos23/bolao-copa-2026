import { Prisma, type ProviderSyncType } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import type { ProviderSnapshotEvidence } from '../providers/competition-data-provider.js';
import { checksum } from '../providers/provider-utils.js';
import {
  INITIAL_SCORING_VERSION_ID,
  INITIAL_TIE_BREAKER_ID,
} from '../scoring/scoring-rules.service.js';
import type { SeasonAchievementDefinition } from '../engagement/competition-achievements.js';

export interface ConmebolCup2026Definition {
  competitionSlug: string;
  seasonSlug: string;
  poolSlug: string;
  competitionName: string;
  seasonName: string;
  presentation?: {
    label?: string;
    theme?: { accent?: string; accentInk?: string; surface?: string; glow?: string };
  };
  fixtureName: string;
  collectionStrategy: 'LIVE_SUDAMERICANA_2026' | 'LIVE_LIBERTADORES_2026' | 'IMMUTABLE_FIXTURE';
  providerKey?: string;
  competitionCapabilities?: Prisma.InputJsonValue;
  providerSettings?: Record<string, Prisma.InputJsonValue>;
  providerEnabledTypes?: ProviderSyncType[];
  predictionPolicy?: {
    scoreableFromRound: number | null;
    startsAtRound: number | null;
  };
  providerProvenance: string;
  policyVersion: string;
  featureReason: string;
  timezone: string;
  scoreableFrom: Date;
  cutoffBasis: string;
  cutoffRequiresOfficialKickoffRevalidation: boolean;
  seasonCapabilities: Prisma.InputJsonValue;
  achievementDefinitions?: SeasonAchievementDefinition[];
}

function providerMapping(input: {
  providerKey: string;
  entityType: 'COMPETITION' | 'COMPETITION_SEASON';
  externalId: string;
  internalId: string;
  seasonId?: string;
  evidence: ProviderSnapshotEvidence;
}) {
  return {
    provider: input.providerKey,
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

export async function prepareConmebolCup2026(input: {
  definition: ConmebolCup2026Definition;
  seasonStartsAt: Date;
  evidence: ProviderSnapshotEvidence;
  actorId?: string | null;
}) {
  const { definition } = input;
  const providerKey = definition.providerKey ?? 'conmebol-official';
  const sourceEvidence = JSON.parse(JSON.stringify(input.evidence)) as Prisma.InputJsonValue;
  const competitionMetadata = {
    source: sourceEvidence,
    ...(definition.presentation ? { presentation: definition.presentation } : {}),
  } satisfies Prisma.InputJsonValue;
  const result = await prisma.$transaction(async (tx) => {
    const competition = await tx.competition.upsert({
      where: { slug: definition.competitionSlug },
      create: {
        slug: definition.competitionSlug,
        name: definition.competitionName,
        capabilities: definition.competitionCapabilities ?? {
          format: 'GROUPS',
          groupStage: true,
          knockout: true,
          twoLegs: true,
          standings: true,
          liveScoring: true,
          rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
        },
        metadata: competitionMetadata,
      },
      update: {
        name: definition.competitionName,
        capabilities: definition.competitionCapabilities ?? {
          format: 'GROUPS',
          groupStage: true,
          knockout: true,
          twoLegs: true,
          standings: true,
          liveScoring: true,
          rankingScopes: ['OVERALL', 'STAGE', 'ROUND'],
        },
        metadata: competitionMetadata,
      },
    });
    const seasonMetadata = {
      source: sourceEvidence,
      publicExposureRecommended: false,
      cutoff: {
        scoreableFrom: definition.scoreableFrom.toISOString(),
        historicalMatchesScoreable: false,
        basis: definition.cutoffBasis,
      },
      gamification: {
        trophyRoomSeason: definition.seasonName,
        achievementKeys: (definition.achievementDefinitions ?? []).map(
          (achievement) => achievement.key,
        ),
      },
    } satisfies Prisma.InputJsonValue;
    const season = await tx.competitionSeason.upsert({
      where: {
        competitionId_slug: {
          competitionId: competition.id,
          slug: definition.seasonSlug,
        },
      },
      create: {
        competitionId: competition.id,
        slug: definition.seasonSlug,
        name: definition.seasonName,
        year: 2026,
        timezone: definition.timezone,
        status: 'DRAFT',
        startsAt: input.seasonStartsAt,
        capabilities: definition.seasonCapabilities,
        metadata: seasonMetadata,
      },
      update: {
        name: definition.seasonName,
        year: 2026,
        timezone: definition.timezone,
        status: 'DRAFT',
        startsAt: input.seasonStartsAt,
        capabilities: definition.seasonCapabilities,
        metadata: seasonMetadata,
      },
    });
    if (definition.achievementDefinitions?.length) {
      await tx.achievementDefinition.createMany({
        data: definition.achievementDefinitions.map((achievement) => ({
          key: achievement.key,
          version: achievement.version,
          name: achievement.name,
          description: achievement.description,
          rarity: achievement.rarity,
          criteria: JSON.parse(JSON.stringify(achievement.criteria)) as Prisma.InputJsonValue,
          checksum: checksum({
            season: definition.seasonSlug,
            key: achievement.key,
            version: achievement.version,
            criteria: achievement.criteria,
          }),
          seasonId: season.id,
        })),
        skipDuplicates: true,
      });
    }
    await tx.seasonProviderConfig.upsert({
      where: { seasonId_providerKey: { seasonId: season.id, providerKey } },
      create: {
        seasonId: season.id,
        providerKey,
        priority: 1,
        enabledTypes: definition.providerEnabledTypes ?? [
          'TEAMS',
          'STRUCTURE',
          'TIES',
          'SCHEDULE',
          'RESULTS',
          'STANDINGS',
        ],
        cadenceSeconds: 300,
        timeoutMs: 20_000,
        active: true,
        includeProfiles: false,
        source: input.evidence.source,
        provenance: definition.providerProvenance,
        settings: {
          competition: definition.competitionSlug,
          fixtureName: definition.fixtureName,
          collectionStrategy: definition.collectionStrategy,
          ...(definition.providerSettings ?? {}),
          fallbackProviders: ['manual'],
          automaticSyncControlledByFeatureFlag: true,
        },
      },
      update: {
        priority: 1,
        enabledTypes: definition.providerEnabledTypes ?? [
          'TEAMS',
          'STRUCTURE',
          'TIES',
          'SCHEDULE',
          'RESULTS',
          'STANDINGS',
        ],
        cadenceSeconds: 300,
        timeoutMs: 20_000,
        active: true,
        includeProfiles: false,
        source: input.evidence.source,
        provenance: definition.providerProvenance,
        settings: {
          competition: definition.competitionSlug,
          fixtureName: definition.fixtureName,
          collectionStrategy: definition.collectionStrategy,
          ...(definition.providerSettings ?? {}),
          fallbackProviders: ['manual'],
          automaticSyncControlledByFeatureFlag: true,
        },
      },
    });
    const scoringRuleSet = await tx.scoringRuleSet.upsert({
      where: { key_version: { key: definition.competitionSlug, version: 1 } },
      create: {
        key: definition.competitionSlug,
        name: `Bolão ${definition.competitionName}`,
        version: 1,
        rules: { exactScore: 15, outcome: 3, oneTeamGoals: 1, miss: 0 },
        tieBreakers: ['points', 'exactScores', 'resultHits', 'oneGoalHits', 'fewerMisses', 'name'],
        effectiveAt: definition.scoreableFrom,
        metadata: {
          immutableVersionId: INITIAL_SCORING_VERSION_ID,
          policyVersion: definition.policyVersion,
        },
      },
      update: {
        name: `Bolão ${definition.competitionName}`,
        rules: { exactScore: 15, outcome: 3, oneTeamGoals: 1, miss: 0 },
        tieBreakers: ['points', 'exactScores', 'resultHits', 'oneGoalHits', 'fewerMisses', 'name'],
        effectiveAt: definition.scoreableFrom,
        metadata: {
          immutableVersionId: INITIAL_SCORING_VERSION_ID,
          policyVersion: definition.policyVersion,
        },
      },
    });
    const pool = await tx.pool.upsert({
      where: { slug: definition.poolSlug },
      create: {
        slug: definition.poolSlug,
        name: 'Bolão do Trabalho',
        isPublic: false,
      },
      update: {},
    });
    const predictionPolicy = {
      scoreableFromRound: definition.predictionPolicy?.scoreableFromRound ?? null,
      scoreableFrom: definition.scoreableFrom,
      startsAtRound: definition.predictionPolicy?.startsAtRound ?? null,
      historicalMatchesScoreable: false,
    } as const;
    const poolSeason = await tx.poolSeason.upsert({
      where: { poolId_seasonId: { poolId: pool.id, seasonId: season.id } },
      create: {
        poolId: pool.id,
        seasonId: season.id,
        scoringRuleSetId: scoringRuleSet.id,
        scoringRuleSetVersionId: INITIAL_SCORING_VERSION_ID,
        tieBreakerRuleSetId: INITIAL_TIE_BREAKER_ID,
        ...predictionPolicy,
        metadata: {
          policyVersion: definition.policyVersion,
          canary: true,
          cutoffRequiresOfficialKickoffRevalidation:
            definition.cutoffRequiresOfficialKickoffRevalidation,
        },
      },
      update: {
        scoringRuleSetId: scoringRuleSet.id,
        scoringRuleSetVersionId: INITIAL_SCORING_VERSION_ID,
        tieBreakerRuleSetId: INITIAL_TIE_BREAKER_ID,
        ...predictionPolicy,
        metadata: {
          policyVersion: definition.policyVersion,
          canary: true,
          cutoffRequiresOfficialKickoffRevalidation:
            definition.cutoffRequiresOfficialKickoffRevalidation,
        },
      },
    });

    for (const entry of [
      providerMapping({
        providerKey,
        entityType: 'COMPETITION',
        externalId: `competition:${definition.competitionSlug}`,
        internalId: competition.id,
        evidence: input.evidence,
      }),
      providerMapping({
        providerKey,
        entityType: 'COMPETITION_SEASON',
        externalId: `season:${definition.seasonSlug}`,
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
      reason: definition.featureReason,
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
            operation: `prepare-${definition.seasonSlug}`,
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
      idempotencyKey: `competition-season-prepared:${season.id}:${input.evidence.checksum}`,
      payload: {
        competitionId: competition.id,
        sourceChecksum: input.evidence.checksum,
        scoreableFrom: definition.scoreableFrom.toISOString(),
        historicalMatchesScoreable: false,
      },
    });
    return { competition, season, pool, poolSeason, eventId: event.id };
  });
  await dispatchOutboxEvent(result.eventId);
  return result;
}
