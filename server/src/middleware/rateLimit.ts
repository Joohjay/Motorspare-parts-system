import type { NextFunction, Request, Response } from 'express';
import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from 'express-rate-limit';

import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

type Limiter = RateLimitRequestHandler;

/**
 * Wraps a rate-limiter so that if the underlying store throws, the request is
 * **blocked** (fail-closed) instead of passed through (fail-open).
 */
function failClosed(limiter: Limiter): Limiter {
  return ((req: Request, res: Response, next: NextFunction) => {
    try {
      limiter(req, res, next);
    } catch (err) {
      logger.error('[rate-limit] store error — blocking request', { error: String(err) });
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Service temporarily unavailable. Please try again later.' },
      });
    }
  }) as unknown as Limiter;
}

// Global limiter applied to the whole /api surface. Prevents basic
// abuse/brute-force against any endpoint until per-route limiters are added.
export const globalLimiter = failClosed(
  rateLimit({
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
  }),
);

const ipKey = (req: Request): string =>
  ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? '127.0.0.1');

// Authentication-specific limiter for login attempts. Successes are not
// counted so legitimate users are never locked out; repeated failures
// (brute-force) are throttled per IP. Created per app instance so tests can
// exercise it with a fresh counter.
export function createAuthLoginLimiter(options?: {
  windowMs?: number;
  max?: number;
}): Limiter {
  return failClosed(
    rateLimit({
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
    }),
  );
}