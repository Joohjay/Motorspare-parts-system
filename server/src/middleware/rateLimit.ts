import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from 'express-rate-limit';

import type { Request } from 'express';

import { config } from '../config/env.js';

// Global limiter applied to the whole /api surface. Prevents basic
// abuse/brute-force against any endpoint until per-route limiters are added.
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  },
  keyGenerator: (req: Request) =>
    ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? '127.0.0.1'),
});

const ipKey = (req: Request): string =>
  ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? '127.0.0.1');

// Authentication-specific limiter for login attempts. Successes are not
// counted so legitimate users are never locked out; repeated failures
// (brute-force) are throttled per IP. Created per app instance so tests can
// exercise it with a fresh counter.
export function createAuthLoginLimiter(options?: {
  windowMs?: number;
  max?: number;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options?.windowMs ?? config.auth.loginRateLimit.windowMs,
    max: options?.max ?? config.auth.loginRateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Please try again later.',
      },
    },
    keyGenerator: ipKey,
  });
}