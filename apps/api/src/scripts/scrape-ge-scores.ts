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

async function main() {
  const watch = process.argv.includes('--watch');
  const force = process.argv.includes('--force');

  await ensureScoreSyncSetting();
  await runControlledScrape(force);

  if (!watch) return;

  setInterval(() => {
    runControlledScrape(false).catch((error) =>
      logger.error({ error }, 'GE score scrape failed'),
    );
  }, GE_SCORE_SCRAPE_POLL_MS);
}

main()
  .catch((error) => {
    logger.error({ error }, 'GE score scraper stopped');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!process.argv.includes('--watch')) await prisma.$disconnect();
  });
