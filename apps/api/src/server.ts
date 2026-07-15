import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';
import { ensurePredictionCloseSetting } from './services/prediction-settings.service.js';
import { createPostgresSessionResources } from './session-store.js';
import { closeAllSseClients } from './realtime/sse.js';
import { createShutdownController } from './runtime/shutdown.js';
import { removeOrphanAvatarFiles } from './services/avatar.service.js';

await ensurePredictionCloseSetting();
await removeOrphanAvatarFiles();
const sessionResources = createPostgresSessionResources();
const app = createApp({ sessionStore: sessionResources.store });
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'API listening');
  if (config.NODE_ENV !== 'test') startJobs();
});

const shutdown = createShutdownController({
  server,
  stopJobs,
  closeSse: closeAllSseClients,
  closeSessionStore: sessionResources.close,
  disconnectPrisma: () => prisma.$disconnect(),
});

function handleShutdown(signal: string) {
  void shutdown()
    .then(() => logger.info({ signal }, 'API shutdown complete'))
    .catch((error) => {
      process.exitCode = 1;
      logger.error({ error, signal }, 'API shutdown failed');
    });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
