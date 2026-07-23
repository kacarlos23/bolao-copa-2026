import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { dispatchOutboxEvent, enqueueOutboxEvent } from '../events/outbox.js';
import {
  achievementIdempotencyKey,
  deriveStreaks,
  type FinalScoreEvent,
} from './gamification.logic.js';
import { stableHash } from '../scoring/scoring-rules.service.js';
import { serializableTransaction } from '../../prisma-transaction.js';
import { isPoolMatchScoreable } from '../predictions/scoreability.js';
import {
  deriveConfiguredAchievementFact,
  type AchievementMatchFact,
  type AchievementScoreFact,
} from './competition-achievements.js';

type AchievementFact = {
  satisfied: boolean;
  provisional: boolean;
  progress: Prisma.InputJsonValue;
};

export async function recomputePoolSeasonEngagement(poolSeasonId: string) {
  const eventIds = await serializableTransaction(async (tx) => {
    const poolSeason = await tx.poolSeason.findUnique({
      where: { id: poolSeasonId },
      select: {
        id: true,
        seasonId: true,
        poolId: true,
        scoreableFromRound: true,
        scoreableFrom: true,
        startsAtRound: true,
        historicalMatchesScoreable: true,
        season: { select: { status: true } },
      },
    });
    if (!poolSeason) return [];
    const [
      users,
      definitions,
      regularScores,
      knockoutScores,
      movements,
      matches,
      predictions,
      brackets,
    ] = await Promise.all([
      tx.user.findMany({
        where: {
          status: 'ACTIVE',
          role: { in: ['USER', 'ADMIN'] },
          poolMemberships: { some: { poolId: poolSeason.poolId, status: 'ACTIVE' } },
        },
        select: { id: true },
      }),
      tx.achievementDefinition.findMany({
        where: { OR: [{ seasonId: poolSeason.seasonId }, { seasonId: null }] },
        orderBy: [{ key: 'asc' }, { version: 'desc' }],
      }),
      tx.predictionScore.findMany({
        where: { poolSeasonId },
        select: {
          userId: true,
          points: true,
          scoreType: true,
          isFinal: true,
          calculationKey: true,
          match: {
            select: {
              id: true,
              seasonId: true,
              startsAt: true,
              status: true,
              stageId: true,
              stage: { select: { type: true } },
              roundId: true,
              round: { select: { order: true } },
              tieId: true,
              legNumber: true,
              tie: { select: { expectedLegs: true } },
            },
          },
        },
      }),
      tx.knockoutPredictionScore.findMany({
        where: { poolSeasonId, isFinal: true },
        select: {
          userId: true,
          points: true,
          scoreType: true,
          calculationKey: true,
          fixture: { select: { id: true, startsAt: true, status: true, matchNumber: true } },
        },
      }),
      tx.rankingMovement.findMany({
        where: { poolSeasonId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      tx.match.findMany({
        where: { seasonId: poolSeason.seasonId },
        select: {
          id: true,
          seasonId: true,
          startsAt: true,
          status: true,
          stageId: true,
          stage: { select: { type: true } },
          roundId: true,
          round: { select: { order: true } },
          tieId: true,
          legNumber: true,
          tie: { select: { expectedLegs: true } },
        },
      }),
      tx.prediction.groupBy({ by: ['userId'], where: { poolSeasonId }, _count: { _all: true } }),
      tx.knockoutBracket.findMany({
        where: { poolSeasonId },
        select: { userId: true, _count: { select: { picks: true } } },
      }),
    ]);

    const definitionsByKey = new Map<string, (typeof definitions)[number]>();
    for (const definition of definitions) {
      if (!definitionsByKey.has(definition.key)) definitionsByKey.set(definition.key, definition);
    }
    const latestDefinitions = [...definitionsByKey.values()];
    const predictionCounts = new Map(predictions.map((item) => [item.userId, item._count._all]));
    const bracketComplete = new Set(
      brackets.filter((item) => item._count.picks === 32).map((item) => item.userId),
    );
    const achievementMatches: AchievementMatchFact[] = matches.map((match) => ({
      seasonId: match.seasonId ?? poolSeason.seasonId,
      matchId: match.id,
      stageId: match.stageId,
      stageType: match.stage?.type ?? null,
      roundId: match.roundId,
      roundOrder: match.round?.order ?? null,
      tieId: match.tieId,
      legNumber: match.legNumber,
      expectedLegs: match.tie?.expectedLegs ?? null,
      status: match.status,
      scoreable: isPoolMatchScoreable(poolSeason, {
        roundOrder: match.round?.order ?? null,
        startsAt: match.startsAt,
      }),
    }));
    const scoreableMatchIds = new Set(
      achievementMatches.filter((match) => match.scoreable).map((match) => match.matchId),
    );
    const achievementScores: AchievementScoreFact[] = regularScores.map((score) => ({
      seasonId: score.match.seasonId ?? poolSeason.seasonId,
      poolSeasonId,
      userId: score.userId,
      matchId: score.match.id,
      points: score.points,
      scoreType: score.scoreType,
      isFinal: score.isFinal,
    }));
    const roundMatches = new Map<string, AchievementMatchFact[]>();
    for (const match of achievementMatches.filter((item) => item.scoreable && item.roundId)) {
      const items = roundMatches.get(match.roundId!) ?? [];
      items.push(match);
      roundMatches.set(match.roundId!, items);
    }
    const roundFinality = new Map(
      [...roundMatches].map(([roundId, items]) => [
        roundId,
        items.length > 0 && items.every((match) => match.status === 'FINISHED'),
      ]),
    );
    const allEvents: FinalScoreEvent[] = [
      ...regularScores
        .filter((score) => scoreableMatchIds.has(score.match.id))
        .map((score) => ({
          eventKey: `match:${score.match.id}`,
          userId: score.userId,
          startsAt: score.match.startsAt,
          order: score.match.round?.order ?? 0,
          points: score.points,
          scoreType: score.scoreType,
          isFinal: score.isFinal,
        })),
      ...knockoutScores.map((score) => ({
        eventKey: `knockout:${score.fixture.id}`,
        userId: score.userId,
        startsAt: score.fixture.startsAt,
        order: score.fixture.matchNumber,
        points: score.points,
        scoreType: score.scoreType,
        isFinal: true,
      })),
    ];
    const sourceRevision = stableHash({
      regular: regularScores.map((score) => score.calculationKey).sort(),
      knockout: knockoutScores.map((score) => score.calculationKey).sort(),
      movements: movements.map((movement) => movement.idempotencyKey).sort(),
      matches: achievementMatches
        .map((match) => `${match.matchId}:${match.status}:${match.scoreable}`)
        .sort(),
    });
    const roundLeaders = new Map<
      string,
      { provisional: boolean; roundId: string; points: number }
    >();
    const scoresByRound = new Map<string, Map<string, number>>();
    for (const score of regularScores) {
      const roundId = score.match.roundId;
      if (!roundId || !score.isFinal || !scoreableMatchIds.has(score.match.id)) continue;
      const totals = scoresByRound.get(roundId) ?? new Map<string, number>();
      totals.set(score.userId, (totals.get(score.userId) ?? 0) + score.points);
      scoresByRound.set(roundId, totals);
    }
    for (const [roundId, totals] of scoresByRound) {
      if (!roundFinality.get(roundId)) continue;
      const best = Math.max(...totals.values());
      for (const [userId, points] of totals) {
        if (points === best) roundLeaders.set(userId, { provisional: false, roundId, points });
      }
    }

    const emitted: string[] = [];
    for (const user of users) {
      const userEvents = allEvents.filter((event) => event.userId === user.id);
      const finalUserEvents = userEvents.filter((event) => event.isFinal);
      const streaks = deriveStreaks(userEvents);
      const storedStreaks = await tx.streak.findMany({ where: { poolSeasonId, userId: user.id } });
      for (const streak of streaks) {
        const stored = storedStreaks.find((item) => item.type === streak.type);
        if (
          stored?.sourceRevision === sourceRevision &&
          stored.currentCount === streak.currentCount &&
          stored.bestCount === streak.bestCount &&
          stored.lastEventKey === streak.lastEventKey
        )
          continue;
        await tx.streak.upsert({
          where: { poolSeasonId_userId_type: { poolSeasonId, userId: user.id, type: streak.type } },
          update: {
            currentCount: streak.currentCount,
            bestCount: streak.bestCount,
            lastEventKey: streak.lastEventKey,
            sourceRevision,
          },
          create: { poolSeasonId, userId: user.id, ...streak, sourceRevision },
        });
      }
      const latestMovement = movements.find((movement) => movement.userId === user.id);
      const leader = roundLeaders.get(user.id);
      const facts = new Map<string, AchievementFact>([
        [
          'FIRST_PREDICTION',
          {
            satisfied: (predictionCounts.get(user.id) ?? 0) > 0,
            provisional: false,
            progress: { current: predictionCounts.get(user.id) ?? 0, target: 1 },
          },
        ],
        [
          'FIRST_EXACT',
          {
            satisfied: finalUserEvents.some((event) => event.scoreType === 'EXACT_SCORE'),
            provisional: false,
            progress: {
              current: finalUserEvents.filter((event) => event.scoreType === 'EXACT_SCORE').length,
              target: 1,
            },
          },
        ],
        [
          'THREE_HIT_STREAK',
          {
            satisfied: (streaks.find((item) => item.type === 'ANY_HIT')?.bestCount ?? 0) >= 3,
            provisional: false,
            progress: {
              current: streaks.find((item) => item.type === 'ANY_HIT')?.bestCount ?? 0,
              target: 3,
            },
          },
        ],
        [
          'ROUND_LEADER',
          {
            satisfied: Boolean(leader),
            provisional: leader?.provisional ?? false,
            progress: leader
              ? { roundId: leader.roundId, points: leader.points }
              : { current: 0, target: 1 },
          },
        ],
        [
          'RANKING_COMEBACK',
          {
            satisfied: (latestMovement?.delta ?? 0) >= 3,
            provisional: latestMovement?.isProvisional ?? false,
            progress: { current: Math.max(0, latestMovement?.delta ?? 0), target: 3 },
          },
        ],
        [
          'COMPLETE_BRACKET',
          {
            satisfied: bracketComplete.has(user.id),
            provisional: false,
            progress: { complete: bracketComplete.has(user.id) },
          },
        ],
      ]);
      for (const definition of latestDefinitions) {
        const configured = deriveConfiguredAchievementFact({
          seasonId: poolSeason.seasonId,
          poolSeasonId,
          userId: user.id,
          criterion: definition.criteria,
          matches: achievementMatches,
          scores: achievementScores,
          seasonFinished: poolSeason.season.status === 'FINISHED',
        });
        if (configured) {
          facts.set(definition.key, {
            satisfied: configured.satisfied,
            provisional: configured.provisional,
            progress: configured.progress,
          });
        }
      }

      for (const definition of latestDefinitions) {
        const fact = facts.get(definition.key);
        if (!fact) continue;
        const idempotencyKey = achievementIdempotencyKey(
          poolSeasonId,
          user.id,
          definition.key,
          definition.version,
        );
        const existing = await tx.userAchievement.findUnique({
          where: {
            poolSeasonId_userId_definitionId: {
              poolSeasonId,
              userId: user.id,
              definitionId: definition.id,
            },
          },
        });
        const sameProgress =
          existing && stableHash(existing.progress) === stableHash(fact.progress);
        const sameState = fact.satisfied
          ? Boolean(
              existing?.achievedAt &&
              !existing.revokedAt &&
              existing.isProvisional === fact.provisional,
            )
          : Boolean(
              existing && (!existing.achievedAt || existing.revokedAt) && !existing.isProvisional,
            );
        if (existing?.sourceRevision === sourceRevision && sameProgress && sameState) continue;
        if (!fact.satisfied) {
          if (existing?.achievedAt) {
            await tx.userAchievement.update({
              where: { id: existing.id },
              data: {
                progress: fact.progress,
                revokedAt: new Date(),
                isProvisional: false,
                sourceRevision,
              },
            });
            const event = await enqueueOutboxEvent(tx, {
              type: 'achievement.updated',
              seasonId: poolSeason.seasonId,
              poolSeasonId,
              payload: {
                userId: user.id,
                definitionKey: definition.key,
                version: definition.version,
                provisional: false,
                revoked: true,
              },
              idempotencyKey: `achievement.revoked:${idempotencyKey}:${sourceRevision}`,
            });
            emitted.push(event.id);
          } else if (existing) {
            await tx.userAchievement.update({
              where: { id: existing.id },
              data: { progress: fact.progress, sourceRevision },
            });
          } else {
            await tx.userAchievement.create({
              data: {
                poolSeasonId,
                userId: user.id,
                definitionId: definition.id,
                idempotencyKey,
                progress: fact.progress,
                isProvisional: false,
                achievedAt: null,
                sourceRevision,
              },
            });
          }
          continue;
        }
        const newlyAchieved = !existing?.achievedAt || Boolean(existing.revokedAt);
        await tx.userAchievement.upsert({
          where: {
            poolSeasonId_userId_definitionId: {
              poolSeasonId,
              userId: user.id,
              definitionId: definition.id,
            },
          },
          update: {
            progress: fact.progress,
            isProvisional: fact.provisional,
            achievedAt: existing?.revokedAt ? new Date() : (existing?.achievedAt ?? new Date()),
            revokedAt: null,
            sourceRevision,
          },
          create: {
            poolSeasonId,
            userId: user.id,
            definitionId: definition.id,
            idempotencyKey,
            progress: fact.progress,
            isProvisional: fact.provisional,
            achievedAt: new Date(),
            sourceRevision,
          },
        });
        if (newlyAchieved) {
          const preference = await tx.notificationPreference.findUnique({
            where: { poolSeasonId_userId: { poolSeasonId, userId: user.id } },
          });
          if (preference?.inAppEnabled !== false) {
            await tx.notificationInbox.createMany({
              data: [
                {
                  poolSeasonId,
                  userId: user.id,
                  type: 'ACHIEVEMENT',
                  title: definition.name,
                  body: definition.description,
                  data: {
                    definitionKey: definition.key,
                    version: definition.version,
                    progress: fact.progress,
                  },
                  isProvisional: fact.provisional,
                  idempotencyKey: `notification:${idempotencyKey}`,
                },
              ],
              skipDuplicates: true,
            });
          }
          const event = await enqueueOutboxEvent(tx, {
            type: 'achievement.updated',
            seasonId: poolSeason.seasonId,
            poolSeasonId,
            payload: {
              userId: user.id,
              definitionKey: definition.key,
              version: definition.version,
              provisional: fact.provisional,
            },
            idempotencyKey: `achievement.updated:${idempotencyKey}:${sourceRevision}`,
          });
          emitted.push(event.id);
        }
      }
    }
    return emitted;
  });

  for (const eventId of eventIds) await dispatchOutboxEvent(eventId);
}

export async function listInbox(poolSeasonId: string, userId: string) {
  return prisma.notificationInbox.findMany({
    where: { poolSeasonId, userId, availableAt: { lte: new Date() } },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });
}

export async function markInboxRead(poolSeasonId: string, userId: string, notificationId: string) {
  await prisma.notificationInbox.updateMany({
    where: { id: notificationId, poolSeasonId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function getEngagementDashboard(poolSeasonId: string, userId: string) {
  const [achievements, streaks, notifications, preferences] = await Promise.all([
    prisma.userAchievement.findMany({
      where: { poolSeasonId, userId },
      include: {
        definition: {
          select: {
            key: true,
            version: true,
            name: true,
            description: true,
            rarity: true,
            criteria: true,
          },
        },
      },
      orderBy: [{ achievedAt: 'desc' }, { definition: { key: 'asc' } }],
    }),
    prisma.streak.findMany({ where: { poolSeasonId, userId }, orderBy: { type: 'asc' } }),
    listInbox(poolSeasonId, userId),
    prisma.notificationPreference.findUnique({
      where: { poolSeasonId_userId: { poolSeasonId, userId } },
    }),
  ]);
  return {
    achievements,
    streaks,
    notifications,
    preferences: preferences ?? {
      inAppEnabled: true,
      pushEnabled: false,
      emailEnabled: false,
      quietHoursEnabled: false,
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'America/Sao_Paulo',
    },
  };
}

export async function updateNotificationPreferences(
  poolSeasonId: string,
  userId: string,
  input: {
    inAppEnabled: boolean;
    pushEnabled: boolean;
    emailEnabled: boolean;
    quietHoursEnabled: boolean;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    timezone: string;
  },
) {
  return prisma.notificationPreference.upsert({
    where: { poolSeasonId_userId: { poolSeasonId, userId } },
    update: input,
    create: { poolSeasonId, userId, ...input },
  });
}

export async function rankingVisitSummary(poolSeasonId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const [visit, latest] = await Promise.all([
      tx.userPoolSeasonVisit.findUnique({
        where: { poolSeasonId_userId: { poolSeasonId, userId } },
        include: { lastSeenSnapshot: true },
      }),
      tx.rankingSnapshot.findFirst({
        where: { poolSeasonId, userId },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const summary =
      latest && visit?.lastSeenSnapshot
        ? {
            fromRank: visit.lastSeenSnapshot.rank,
            toRank: latest.rank,
            delta: visit.lastSeenSnapshot.rank - latest.rank,
            provisional: visit.lastSeenSnapshot.hasLiveData || latest.hasLiveData,
            since: visit.lastSeenAt.toISOString(),
          }
        : null;
    await tx.userPoolSeasonVisit.upsert({
      where: { poolSeasonId_userId: { poolSeasonId, userId } },
      update: { lastSeenSnapshotId: latest?.id ?? null, lastSeenAt: new Date() },
      create: { poolSeasonId, userId, lastSeenSnapshotId: latest?.id ?? null },
    });
    return summary;
  });
}
