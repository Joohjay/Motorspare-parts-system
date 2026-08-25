import { createServer } from 'node:http';

import { createApp } from './app.js';
import { config } from './config/env.js';
import prisma from './lib/prisma.js';
import { logger } from './lib/logger.js';

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('unhandled_rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err: Error) => {
  logger.error('uncaught_exception', { message: err.message });
  process.exit(1);
});

const app = createApp();
const server = createServer(app);

server.timeout = 30_000;
server.headersTimeout = 15_000;

server.listen(config.port, async () => {
  logger.info(
    `makire-motorparts-api listening on http://localhost:${config.port} (${config.env})`,
  );

  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('database connection verified');
  } catch {
    logger.warn(
      'database is unreachable on startup - data endpoints will fail until it is available',
    );
  }
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));