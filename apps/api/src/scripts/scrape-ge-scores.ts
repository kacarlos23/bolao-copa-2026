import 'dotenv/config';
import { logger } from '../logger.js';
import { prisma } from '../prisma.js';
import {
  GE_SCORE_SCRAPE_POLL_MS,
  runGeScoreScrapeOnce,
} from '../services/ge-score-sync.service.js';
import {
  ensureScoreSyncSetting,
  getScoreSyncSetting,
} from '../services/score-sync-settings.service.js';

async function runControlledScrape(force: boolean) {
  if (!force) {
    const setting = await getScoreSyncSetting();
    if (!setting.enabled) {
      logger.info('GE score scrape skipped because score sync is disabled');
      return null;
    }
  }

  return runGeScoreScrapeOnce();
}

let watchTimer: NodeJS.Timeout | undefined;
let activeScrape: Promise<unknown> | null = null;
let shuttingDown = false;

function startScrape(force: boolean) {
  const run = runControlledScrape(force);
  const tracked = run.finally(() => {
    if (activeScrape === tracked) activeScrape = null;
  });
  activeScrape = tracked;
  return tracked;
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = undefined;
  await activeScrape?.catch(() => undefined);
  await prisma.$disconnect();
  logger.info({ signal }, 'GE score watcher stopped cleanly');
}

async function main() {
  const watch = process.argv.includes('--watch');
  const force = process.argv.includes('--force');

  await ensureScoreSyncSetting();
  await startScrape(force);

  if (!watch) return;

  watchTimer = setInterval(() => {
    startScrape(false).catch((error) => logger.error({ error }, 'GE score scrape failed'));
  }, GE_SCORE_SCRAPE_POLL_MS);

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main()
  .catch((error) => {
    logger.error({ error }, 'GE score scraper stopped');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!process.argv.includes('--watch') || !watchTimer) await prisma.$disconnect();
  });
