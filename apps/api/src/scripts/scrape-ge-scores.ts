import 'dotenv/config';
import { logger } from '../logger.js';
import { prisma } from '../prisma.js';
import {
  GE_SCORE_SCRAPE_POLL_MS,
  runGeScoreScrapeOnce,
} from '../services/ge-score-sync.service.js';

async function main() {
  const watch = process.argv.includes('--watch');

  await runGeScoreScrapeOnce();

  if (!watch) return;

  setInterval(() => {
    runGeScoreScrapeOnce().catch((error) => logger.error({ error }, 'GE score scrape failed'));
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
