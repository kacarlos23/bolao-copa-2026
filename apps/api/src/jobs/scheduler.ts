import { logger } from '../logger.js';
import { config } from '../config.js';
import { dispatchPendingOutboxEvents } from '../modules/events/outbox.js';
import { runNextAdminJob } from '../modules/admin/admin-job.service.js';
import { runAutomaticBrasileiraoSync } from '../modules/providers/season-result-sync.service.js';

let timer: NodeJS.Timeout | undefined;
let brasileiraoTimer: NodeJS.Timeout | undefined;
let activeRun = false;
let activeBrasileiraoSync = false;

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

async function pollBrasileirao() {
  if (activeBrasileiraoSync) return;
  activeBrasileiraoSync = true;
  try {
    const summary = await runAutomaticBrasileiraoSync();
    if (summary) {
      logger.info(
        {
          changedMatches: summary.changedMatches,
          updatedProfiles: summary.updatedProfiles,
          runs: summary.runs.map((run) => ({ type: run.type, status: run.status })),
        },
        'automatic Brasileirao sync finished',
      );
    }
  } catch (error) {
    logger.error({ err: error }, 'automatic Brasileirao sync failed');
  } finally {
    activeBrasileiraoSync = false;
  }
}

export function startJobs() {
  if (timer) return;
  void pollOutbox();
  timer = setInterval(() => void pollOutbox(), 1_000);
  timer.unref?.();
  void pollBrasileirao();
  brasileiraoTimer = setInterval(
    () => void pollBrasileirao(),
    Math.max(5, config.LIVE_POLL_SECONDS) * 1_000,
  );
  brasileiraoTimer.unref?.();
  logger.info('Outbox dispatcher and automatic Brasileirao sync started');
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  if (brasileiraoTimer) clearInterval(brasileiraoTimer);
  timer = undefined;
  brasileiraoTimer = undefined;
}
