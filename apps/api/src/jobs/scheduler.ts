import { logger } from '../logger.js';
import { config } from '../config.js';
import { dispatchPendingOutboxEvents } from '../modules/events/outbox.js';
import { runNextAdminJob } from '../modules/admin/admin-job.service.js';
import { runAutomaticSeasonSyncs } from '../modules/providers/season-result-sync.service.js';
import { redactProviderError } from '../modules/providers/provider-utils.js';

let timer: NodeJS.Timeout | undefined;
let seasonSyncTimer: NodeJS.Timeout | undefined;
let activeRun: Promise<void> | undefined;
let activeSeasonSync: Promise<void> | undefined;
let stopping = false;

async function pollOutbox() {
  if (stopping) return;
  if (activeRun) return activeRun;
  activeRun = (async () => {
    try {
      await dispatchPendingOutboxEvents();
      await runNextAdminJob();
    } catch (error) {
      logger.error({ error: redactProviderError(error) }, 'outbox poll failed');
    }
  })().finally(() => {
    activeRun = undefined;
  });
  return activeRun;
}

export async function pollConfiguredSeasonProviders() {
  if (stopping) return;
  if (activeSeasonSync) return activeSeasonSync;
  activeSeasonSync = (async () => {
    try {
      const results = await runAutomaticSeasonSyncs();
      for (const result of results) {
        if (!result.ok) {
          logger.error(
            {
              error: redactProviderError(result.error),
              seasonId: result.seasonId,
            },
            'automatic season provider sync failed',
          );
          continue;
        }
        logger.info(
          {
            seasonId: result.seasonId,
            changedMatches: result.summary.changedMatches,
            updatedProfiles: result.summary.updatedProfiles,
            schedule: result.schedule.providers.map((provider) => ({
              providerKey: provider.providerKey,
              mode: provider.mode,
              nextRunAt: provider.nextRunAt,
            })),
            runs: result.summary.runs.map((run) => ({ type: run.type, status: run.status })),
          },
          'automatic season provider sync finished',
        );
      }
    } catch (error) {
      logger.error(
        { error: redactProviderError(error) },
        'automatic season provider scheduler failed',
      );
    }
  })().finally(() => {
    activeSeasonSync = undefined;
  });
  return activeSeasonSync;
}

export function startJobs() {
  if (timer) return;
  stopping = false;
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

export async function stopJobs() {
  stopping = true;
  if (timer) clearInterval(timer);
  if (seasonSyncTimer) clearInterval(seasonSyncTimer);
  timer = undefined;
  seasonSyncTimer = undefined;
  await Promise.allSettled([activeRun, activeSeasonSync].filter(Boolean));
}
