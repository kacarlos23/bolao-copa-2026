import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'API listening');
  if (config.NODE_ENV !== 'test') startJobs();
});

async function shutdown() {
  stopJobs();
  server.close();
  await prisma.$disconnect();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
