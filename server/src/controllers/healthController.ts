import type { Request, Response } from 'express';

import prisma from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getHealth = asyncHandler(async (_req: Request, res: Response) => {
  let database = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'up';
  } catch {
    // Database reachability is reported in the response body; the API itself
    // stays up so monitoring can see the degraded state.
  }

  res.json({
    status: 'ok',
    service: 'makire-motorparts-api',
    database,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});