import { PrismaClient } from '@prisma/client';

import { config } from '../config/env.js';

// Centralized Prisma client. Database access is only performed through here
// (services/repositories), never scattered across controllers or routes.
const client = new PrismaClient({
  log: config.isProduction
    ? [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }]
    : [],
});

// Test seam: automated tests replace the real client with an in-memory mock by
// setting globalThis.__MAKIRE_PRISMA__ before the module graph loads. In
// normal operation this is never set.
const injected = (globalThis as { __MAKIRE_PRISMA__?: typeof client })
  .__MAKIRE_PRISMA__;

const prisma = injected ?? client;

if (config.isProduction) {
  prisma.$on('warn', (e) => {
    console.warn('[prisma] warn:', e.message);
  });
  prisma.$on('error', (e) => {
    console.error('[prisma] error:', e.message);
  });
}

export default prisma;