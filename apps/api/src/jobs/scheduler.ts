import { logger } from '../logger.js';
import { dispatchPendingOutboxEvents } from '../modules/events/outbox.js';

let timer: NodeJS.Timeout | undefined;
let activeRun = false;

async function pollOutbox() {
  if (activeRun) return;
  activeRun = true;
  try {
    await dispatchPendingOutboxEvents();
  } catch (error) {
    logger.error({ err: error }, 'outbox poll failed');
  } finally {
    activeRun = false;
  }
}

export function startJobs() {
  if (timer) return;
  void pollOutbox();
  timer = setInterval(() => void pollOutbox(), 1_000);
  timer.unref?.();
  logger.info('Outbox dispatcher started; fixture polling remains disabled');
}

export function stopJobs() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
