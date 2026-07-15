import { prisma } from '../prisma.js';
import { WORLD_CUP_CONTEXT } from '../domain/world-cup-context.js';
import { recomputePoolSeasonEngagement } from '../modules/engagement/engagement.service.js';
import { refreshRankingSnapshot } from '../services/ranking.service.js';

async function main() {
  await refreshRankingSnapshot(WORLD_CUP_CONTEXT);
  await recomputePoolSeasonEngagement(WORLD_CUP_CONTEXT.poolSeasonId);

  const [achievements, streaks, snapshots, movements, notifications, outboxEvents] = await Promise.all([
    prisma.userAchievement.count({ where: { poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId } }),
    prisma.streak.count({ where: { poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId } }),
    prisma.rankingSnapshot.count({ where: { poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId } }),
    prisma.rankingMovement.count({ where: { poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId } }),
    prisma.notificationInbox.count({ where: { poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId } }),
    prisma.outboxEvent.count({ where: { poolSeasonId: WORLD_CUP_CONTEXT.poolSeasonId } }),
  ]);

  console.log(JSON.stringify({ achievements, streaks, snapshots, movements, notifications, outboxEvents }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
