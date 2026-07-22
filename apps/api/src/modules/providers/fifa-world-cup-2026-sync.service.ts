import { MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../../prisma.js';
import { recalculateKnockoutScoresForFixture } from '../../services/knockout.service.js';
import { refreshRankingSnapshot } from '../../services/ranking.service.js';
import { WORLD_CUP_CONTEXT } from '../../domain/world-cup-context.js';
import {
  FIFA_WORLD_CUP_2026_MATCHES_URL,
  type FifaLegacyKnockoutUpdate,
} from './adapters/fifa-world-cup-2026.provider.js';
import { checksum } from './provider-utils.js';

export interface LegacyKnockoutSyncSummary {
  type: 'LEGACY_KNOCKOUT';
  fetched: number;
  updated: number;
  unchanged: number;
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function syncFifaWorldCup2026LegacyKnockout(
  updates: readonly FifaLegacyKnockoutUpdate[],
  seasonId: string = WORLD_CUP_CONTEXT.seasonId,
): Promise<LegacyKnockoutSyncSummary> {
  const [fixtures, seasonTeams] = await Promise.all([
    prisma.knockoutFixture.findMany({
      where: { seasonId },
      orderBy: { matchNumber: 'asc' },
    }),
    prisma.seasonTeam.findMany({
      where: { seasonId },
      include: { team: { select: { id: true, code: true } } },
    }),
  ]);
  const fixtureByNumber = new Map(fixtures.map((fixture) => [fixture.matchNumber, fixture]));
  const teamByCode = new Map(
    seasonTeams.flatMap(({ team }) =>
      team.code ? [[team.code.toUpperCase(), team.id] as const] : [],
    ),
  );
  const changedFixtureIds: string[] = [];
  let unchanged = 0;

  for (const update of updates) {
    const fixture = fixtureByNumber.get(update.matchNumber);
    if (!fixture) continue;
    const homeTeamId = teamByCode.get(update.homeCode.toUpperCase());
    const awayTeamId = teamByCode.get(update.awayCode.toUpperCase());
    const winnerTeamId = update.winnerCode
      ? teamByCode.get(update.winnerCode.toUpperCase())
      : undefined;
    if (!homeTeamId || !awayTeamId || (update.winnerCode && !winnerTeamId)) {
      throw new Error(`FIFA knockout match ${update.matchNumber} contains an unknown team code.`);
    }
    const incomingStatus = MatchStatus[update.status];
    const effectiveStatus =
      fixture.status === MatchStatus.FINISHED && incomingStatus !== MatchStatus.FINISHED
        ? MatchStatus.FINISHED
        : incomingStatus;
    const startsAt = new Date(update.startsAt);
    const homeScore = update.homeScore ?? null;
    const awayScore = update.awayScore ?? null;
    const finalHomeScore = effectiveStatus === MatchStatus.FINISHED ? homeScore : null;
    const finalAwayScore = effectiveStatus === MatchStatus.FINISHED ? awayScore : null;
    const changed =
      fixture.homeTeamId !== homeTeamId ||
      fixture.awayTeamId !== awayTeamId ||
      fixture.winnerTeamId !== (winnerTeamId ?? null) ||
      fixture.startsAt.getTime() !== startsAt.getTime() ||
      fixture.status !== effectiveStatus ||
      fixture.homeScore !== homeScore ||
      fixture.awayScore !== awayScore ||
      fixture.finalHomeScore !== finalHomeScore ||
      fixture.finalAwayScore !== finalAwayScore;
    if (!changed) {
      unchanged += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.knockoutFixture.update({
        where: { id: fixture.id },
        data: {
          homeTeamId,
          awayTeamId,
          winnerTeamId: winnerTeamId ?? null,
          startsAt,
          status: effectiveStatus,
          homeScore,
          awayScore,
          finalHomeScore,
          finalAwayScore,
          lastSyncedAt: new Date(),
          rawPayload: json({
            source: FIFA_WORLD_CUP_2026_MATCHES_URL,
            officialMatchId: update.officialMatchId,
            penaltyHomeScore: update.penaltyHomeScore ?? null,
            penaltyAwayScore: update.penaltyAwayScore ?? null,
          }),
        },
      });
      const externalId = `season:${seasonId}:match:${update.officialMatchId}`;
      await tx.providerEntityMapping.upsert({
        where: {
          provider_scopeKey_entityType_externalId: {
            provider: 'fifa-official',
            scopeKey: `season:${seasonId}`,
            entityType: 'MATCH',
            externalId,
          },
        },
        create: {
          provider: 'fifa-official',
          scopeKey: `season:${seasonId}`,
          entityType: 'MATCH',
          externalId,
          internalId: fixture.id,
          seasonId,
          sourceUrl: FIFA_WORLD_CUP_2026_MATCHES_URL,
          collectedAt: new Date(),
          checksum: checksum(update),
          metadata: {
            rawExternalId: `match:${update.officialMatchId}`,
            internalModel: 'KnockoutFixture',
          },
        },
        update: {
          internalId: fixture.id,
          sourceUrl: FIFA_WORLD_CUP_2026_MATCHES_URL,
          collectedAt: new Date(),
          checksum: checksum(update),
        },
      });
    });
    changedFixtureIds.push(fixture.id);
  }

  for (const fixtureId of changedFixtureIds) {
    await recalculateKnockoutScoresForFixture(fixtureId, { refreshRanking: false });
  }
  if (changedFixtureIds.length) await refreshRankingSnapshot();
  return {
    type: 'LEGACY_KNOCKOUT',
    fetched: updates.length,
    updated: changedFixtureIds.length,
    unchanged,
  };
}
