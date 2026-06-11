import { logger } from '../logger.js';

let timer: NodeJS.Timeout | undefined;

export function startJobs() {
  logger.info('Background jobs disabled: fixtures are managed locally by admin');
}

export function stopJobs() {
  if (timer) clearTimeout(timer);
}
