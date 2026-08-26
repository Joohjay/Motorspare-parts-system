import cluster from 'node:cluster';
import { cpus } from 'node:os';
import { createServer } from 'node:http';

import { config } from './config/env.js';
import { logger } from './lib/logger.js';

// ── Memory tuning ──────────────────────────────────────────────────────
// Cap heap at 1.5 GB per worker to prevent OOM from killing the process
// silently. 20k concurrent connections with JSON bodies rarely exceed
// 512 MB per worker, but the headroom handles spikes.
const MAX_HEAP_MB = 1536;

if (config.isProduction) {
  const v8 = await import('node:v8');
  v8.setFlagsFromString(`--max-old-space-size=${MAX_HEAP_MB}`);
}

// ── Cluster mode ───────────────────────────────────────────────────────
// One worker per CPU core. Each worker runs its own Express instance with
// its own Prisma connection pool.  A single process caps at ~5k concurrent
// connections; 4-8 workers comfortably handle 20k+ with headroom.
const WORKER_COUNT = config.isProduction
  ? Math.min(cpus().length, 8) // cap at 8 even on huge boxes
  : 1; // single process in dev/test

if (cluster.isPrimary && config.isProduction) {
  logger.info(`primary ${process.pid} forking ${WORKER_COUNT} workers`);

  for (let i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.error(`worker ${worker.process.pid} died (code=${code}, signal=${signal})`);
    // Auto-restart dead workers
    cluster.fork();
  });

  // Graceful shutdown of the primary
  process.on('SIGINT', () => {
    logger.info('SIGINT received — shutting down workers');
    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill('SIGTERM');
    }
  });
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down workers');
    for (const id in cluster.workers) {
      cluster.workers[id]?.process.kill('SIGTERM');
    }
  });
} else {
  // ── Worker process ─────────────────────────────────────────────────
  const { createApp } = await import('./app.js');
  const prisma = (await import('./lib/prisma.js')).default;

  const app = createApp();
  const server = createServer(app);

  // Connection tuning: higher timeouts for slow clients, keep-alive for
  // connection reuse which is critical at scale.
  server.timeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 65_000; // slightly below LB idle timeout
  server.maxHeadersCount = 50; // reduce header processing overhead

  server.listen(config.port, async () => {
    logger.info(
      `worker ${process.pid} listening on :${config.port} (${config.env})`,
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
    logger.info(`worker ${process.pid}: ${signal} received, shutting down...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });

    setTimeout(() => {
      logger.error(`worker ${process.pid}: forced shutdown after timeout`);
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('unhandled_rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (err: Error) => {
    logger.error('uncaught_exception', { message: err.message });
    process.exit(1);
  });
}
