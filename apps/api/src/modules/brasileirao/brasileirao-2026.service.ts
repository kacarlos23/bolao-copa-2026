import { Prisma, type RoundStatus } from '@prisma/client';
import { AppError } from '../../http/errors.js';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import type { NormalizedMatch, NormalizedTeam } from '../providers/competition-data-provider.js';
import {
  CBF_SERIE_A_2026_COMPETITION_ID,
  CBF_SERIE_A_2026_PHASE_ID,
  CBF_SERIE_A_2026_TABLE_URL,
  type CbfSerieA2026Evidence,
} from '../providers/adapters/cbf-serie-a-2026.provider.js';
import { checksum } from '../providers/provider-utils.js';

export const BRASILEIRAO_COMPETITION_SLUG = 'brasileirao-serie-a';
export const BRASILEIRAO_2026_SEASON_SLUG = 'brasileirao-serie-a-2026';
export const BRASILEIRAO_2026_POOL_SLUG = 'bolao-do-trabalho';
export const BRASILEIRAO_2026_STARTS_AT_ROUND = 20;
export const BRASILEIRAO_2026_TIMEZONE = 'America/Sao_Paulo';
export const BRASILEIRAO_2026_TIE_BREAK_VERSION = 'cbf-rec-2026-art-15-v1';

export interface Brasileirao2026Readiness {
  openingStartsAt: Date;
  seasonStartsAt: Date;
  reconciledMatches: number;
  openingMatches: number;
}

export function assertBrasileirao2026Readiness(input: {
  teams: NormalizedTeam[];
  schedule: NormalizedMatch[];
  evidence: CbfSerieA2026Evidence;
}): Brasileirao2026Readiness {
  const openingMatches = input.schedule.filter(
    (match) => match.roundExternalId === `round:${BRASILEIRAO_2026_STARTS_AT_ROUND}`,
  );
  const openingTimes = openingMatches
    .map((match) => (match.startsAt ? new Date(match.startsAt) : null))
    .filter((value): value is Date => Boolean(value) && !Number.isNaN(value!.getTime()));
  const seasonTimes = input.schedule
    .map((match) => (match.startsAt ? new Date(match.startsAt) : null))
    .filter((value): value is Date => Boolean(value) && !Number.isNaN(value!.getTime()));
  if (
    input.teams.length !== 20 ||
    input.evidence.rawMatches !== 380 ||
    openingMatches.length !== 10 ||
    openingTimes.length !== 10 ||
    seasonTimes.length === 0
  ) {
    throw new AppError(
      409,
      'A fonte oficial ainda não satisfaz os gates; mantenha a temporada oculta e escolha uma rodada posterior.',
      'BRASILEIRAO_SOURCE_INCOMPLETE',
    );
  }
  return {
    openingStartsAt: new Date(Math.min(...openingTimes.map((value) => value.getTime()))),
    seasonStartsAt: new Date(Math.min(...seasonTimes.map((value) => value.getTime()))),
    reconciledMatches: input.schedule.length,
    openingMatches: openingMatches.length,
  };
}

function mapping(input: {
  entityType: 'COMPETITION' | 'COMPETITION_SEASON' | 'STAGE' | 'ROUND';
  externalId: string;
  internalId: string;
  seasonId?: string;
  collectedAt: Date;
  checksum: string;
}) {
  return {
    provider: 'cbf-official',
    entityType: input.entityType,
    externalId: input.externalId,
    internalId: input.internalId,
    seasonId: input.seasonId,
    sourceUrl: CBF_SERIE_A_2026_TABLE_URL,
    collectedAt: input.collectedAt,
    checksum: input.checksum,
  } satisfies Prisma.ProviderEntityMappingUncheckedCreateInput;
}

export async function prepareBrasileirao2026(input: {
  readiness: Brasileirao2026Readiness;
  evidence: CbfSerieA2026Evidence;
  actorId?: string | null;
}) {
  const collectedAt = new Date(input.evidence.collectedAt);
  const sourceEvidence = JSON.parse(JSON.stringify(input.evidence)) as Prisma.InputJsonValue;
  const result = await prisma.$transaction(async (tx) => {
    const competition = await tx.competition.upsert({
      where: { slug: BRASILEIRAO_COMPETITION_SLUG },
      create: {
        slug: BRASILEIRAO_COMPETITION_SLUG,
        name: 'Brasileirão Série A',
        capabilities: {
          format: 'LEAGUE',
          standings: true,
          knockout: false,
          rankingScopes: ['OVERALL', 'ROUND', 'MONTH', 'TURN'],
        },
        metadata: { source: sourceEvidence },
      },
      update: {
        name: 'Brasileirão Série A',
        capabilities: {
          format: 'LEAGUE',
          standings: true,
          knockout: false,
          rankingScopes: ['OVERALL', 'ROUND', 'MONTH', 'TURN'],
        },
        metadata: { source: sourceEvidence },
      },
    });
    const season = await tx.competitionSeason.upsert({
      where: {
        competitionId_slug: {
          competitionId: competition.id,
          slug: BRASILEIRAO_2026_SEASON_SLUG,
        },
      },
      create: {
        competitionId: competition.id,
        slug: BRASILEIRAO_2026_SEASON_SLUG,
        name: 'Brasileirão Série A 2026',
        year: 2026,
        timezone: BRASILEIRAO_2026_TIMEZONE,
        status: 'DRAFT',
        startsAt: input.readiness.seasonStartsAt,
        capabilities: {
          format: 'LEAGUE',
          rounds: 38,
          teams: 20,
          lastFiveUnit: 'MATCH',
        },
        metadata: {
          source: sourceEvidence,
          tieBreakRule: BRASILEIRAO_2026_TIE_BREAK_VERSION,
          publicExposureRecommended: false,
        },
      },
      update: {
        name: 'Brasileirão Série A 2026',
        year: 2026,
        timezone: BRASILEIRAO_2026_TIMEZONE,
        startsAt: input.readiness.seasonStartsAt,
        capabilities: {
          format: 'LEAGUE',
          rounds: 38,
          teams: 20,
          lastFiveUnit: 'MATCH',
        },
        metadata: {
          source: sourceEvidence,
          tieBreakRule: BRASILEIRAO_2026_TIE_BREAK_VERSION,
          publicExposureRecommended: false,
        },
      },
    });
    const stage = await tx.stage.upsert({
      where: { seasonId_slug: { seasonId: season.id, slug: 'serie-a' } },
      create: {
        seasonId: season.id,
        slug: 'serie-a',
        name: 'Série A',
        type: 'LEAGUE',
        order: 1,
        metadata: { rounds: 38, legs: 2 },
      },
      update: {
        name: 'Série A',
        type: 'LEAGUE',
        order: 1,
        metadata: { rounds: 38, legs: 2 },
      },
    });
    const rounds = [];
    for (let order = 1; order <= 38; order += 1) {
      rounds.push(
        await tx.round.upsert({
          where: { stageId_order: { stageId: stage.id, order } },
          create: {
            seasonId: season.id,
            stageId: stage.id,
            name: `Rodada ${order}`,
            order,
            metadata: { turn: order <= 19 ? 1 : 2 },
          },
          update: {
            name: `Rodada ${order}`,
            metadata: { turn: order <= 19 ? 1 : 2 },
          },
        }),
      );
    }
    const scoringRuleSet = await tx.scoringRuleSet.upsert({
      where: { key_version: { key: 'brasileirao-serie-a', version: 1 } },
      create: {
        key: 'brasileirao-serie-a',
        name: 'Bolão Brasileirão Série A',
        version: 1,
        rules: { exactScore: 15, outcome: 3, oneTeamGoals: 1, miss: 0 },
        tieBreakers: ['points', 'exactScores', 'resultHits', 'oneGoalHits', 'fewerMisses', 'name'],
        effectiveAt: input.readiness.openingStartsAt,
        metadata: { source: 'packages/shared/src/scoring.ts' },
      },
      update: {
        name: 'Bolão Brasileirão Série A',
        rules: { exactScore: 15, outcome: 3, oneTeamGoals: 1, miss: 0 },
        tieBreakers: ['points', 'exactScores', 'resultHits', 'oneGoalHits', 'fewerMisses', 'name'],
        effectiveAt: input.readiness.openingStartsAt,
      },
    });
    const pool = await tx.pool.upsert({
      where: { slug: BRASILEIRAO_2026_POOL_SLUG },
      create: {
        slug: BRASILEIRAO_2026_POOL_SLUG,
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
        scoreableFromRound: BRASILEIRAO_2026_STARTS_AT_ROUND,
        scoreableFrom: input.readiness.openingStartsAt,
        startsAtRound: BRASILEIRAO_2026_STARTS_AT_ROUND,
        historicalMatchesScoreable: false,
        metadata: { policyVersion: 'brasileirao-2026-v1', canary: true },
      },
      update: {
        scoringRuleSetId: scoringRuleSet.id,
        scoreableFromRound: BRASILEIRAO_2026_STARTS_AT_ROUND,
        scoreableFrom: input.readiness.openingStartsAt,
        startsAtRound: BRASILEIRAO_2026_STARTS_AT_ROUND,
        historicalMatchesScoreable: false,
        metadata: { policyVersion: 'brasileirao-2026-v1', canary: true },
      },
    });

    const mappings = [
      mapping({
        entityType: 'COMPETITION',
        externalId: `competition:${CBF_SERIE_A_2026_COMPETITION_ID}`,
        internalId: competition.id,
        collectedAt,
        checksum: checksum({ slug: competition.slug, source: input.evidence.checksum }),
      }),
      mapping({
        entityType: 'COMPETITION_SEASON',
        externalId: `season:${CBF_SERIE_A_2026_COMPETITION_ID}`,
        internalId: season.id,
        seasonId: season.id,
        collectedAt,
        checksum: checksum({ slug: season.slug, source: input.evidence.checksum }),
      }),
      mapping({
        entityType: 'STAGE',
        externalId: `stage:${CBF_SERIE_A_2026_PHASE_ID}`,
        internalId: stage.id,
        seasonId: season.id,
        collectedAt,
        checksum: checksum({ stage: CBF_SERIE_A_2026_PHASE_ID, type: 'LEAGUE' }),
      }),
      ...rounds.map((round) =>
        mapping({
          entityType: 'ROUND',
          externalId: `round:${round.order}`,
          internalId: round.id,
          seasonId: season.id,
          collectedAt,
          checksum: checksum({ round: round.order, phase: CBF_SERIE_A_2026_PHASE_ID }),
        }),
      ),
    ];
    for (const entry of mappings) {
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
        },
      });
    }
    await tx.appSetting.upsert({
      where: { key: `competition-features:${season.id}` },
      create: {
        key: `competition-features:${season.id}`,
        value: {
          readEnabled: false,
          writeEnabled: false,
          uiEnabled: false,
          reason: 'Canário administrativo inicial',
          updatedAt: new Date().toISOString(),
          updatedById: input.actorId ?? null,
        },
      },
      update: {},
    });
    if (input.actorId) {
      await tx.adminAuditLog.create({
        data: {
          actorId: input.actorId,
          action: 'MANUAL_SYNC',
          targetId: season.id,
          details: {
            operation: 'prepare-brasileirao-2026',
            source: input.evidence.source,
            checksum: input.evidence.checksum,
            startsAtRound: BRASILEIRAO_2026_STARTS_AT_ROUND,
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
        startsAtRound: BRASILEIRAO_2026_STARTS_AT_ROUND,
        sourceChecksum: input.evidence.checksum,
      },
    });
    return { competition, season, stage, rounds, pool, poolSeason, eventId: event.id };
  });
  await dispatchOutboxEvent(result.eventId);
  return result;
}

export async function refreshBrasileirao2026RoundWindows(seasonId: string) {
  const rounds = await prisma.round.findMany({
    where: { seasonId },
    orderBy: { order: 'asc' },
    include: {
      matches: { select: { startsAt: true, status: true }, orderBy: { startsAt: 'asc' } },
    },
  });
  await prisma.$transaction(
    rounds.map((round) => {
      const startsAt = round.matches[0]?.startsAt ?? null;
      const endsAt = round.matches.at(-1)?.startsAt ?? null;
      const status: RoundStatus =
        round.matches.length === 10 && round.matches.every((match) => match.status === 'FINISHED')
          ? 'FINISHED'
          : round.matches.some((match) => ['LIVE', 'FINISHED'].includes(match.status))
            ? 'ACTIVE'
            : 'SCHEDULED';
      return prisma.round.update({
        where: { id: round.id },
        data: { startsAt, endsAt, status },
      });
    }),
  );
}
