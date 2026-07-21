import { logger } from '../logger.js';
import { config } from '../config.js';
import { dispatchPendingOutboxEvents } from '../modules/events/outbox.js';
import { runNextAdminJob } from '../modules/admin/admin-job.service.js';
import { runAutomaticSeasonSyncs } from '../modules/providers/season-result-sync.service.js';

let timer: NodeJS.Timeout | undefined;
let seasonSyncTimer: NodeJS.Timeout | undefined;
let activeRun = false;
let activeSeasonSync = false;

async function pollOutbox() {
  if (activeRun) return;
  activeRun = true;
  try {
    await dispatchPendingOutboxEvents();
    await runNextAdminJob();
  } catch (error) {
    logger.error({ err: error }, 'outbox poll failed');
  } finally {
    activeRun = false;
  }
}

export async function pollConfiguredSeasonProviders() {
  if (activeSeasonSync) return;
  activeSeasonSync = true;
  try {
    const results = await runAutomaticSeasonSyncs();
    for (const result of results) {
      if (!result.ok) {
        logger.error(
          { err: result.error, seasonId: result.seasonId },
          'automatic season provider sync failed',
        );
        continue;
      }
      logger.info(
        {
          seasonId: result.seasonId,
          changedMatches: result.summary.changedMatches,
          updatedProfiles: result.summary.updatedProfiles,
          runs: result.summary.runs.map((run) => ({ type: run.type, status: run.status })),
        },
        'automatic season provider sync finished',
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'automatic season provider scheduler failed');
  } finally {
    activeSeasonSync = false;
  }
}

export function startJobs() {
  if (timer) return;
  void pollOutbox();
  timer = setInterval(() => void pollOutbox(), 1_000);
  timer.unref?.();
  void pollConfiguredSeasonProviders();
  seasonSyncTimer = setInterval(
    () => void pollConfiguredSeasonProviders(),
    Math.max(5, config.LIVE_POLL_SECONDS) * 1_000,
  );
  seasonSyncTimer.unref?.();
  logger.info('Outbox dispatcher and configured season provider sync started');
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  if (seasonSyncTimer) clearInterval(seasonSyncTimer);
  timer = undefined;
  seasonSyncTimer = undefined;
}
