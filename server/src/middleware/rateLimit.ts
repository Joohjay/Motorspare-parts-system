import type { NextFunction, Request, Response } from 'express';
import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from 'express-rate-limit';

import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { recordRateLimitHit } from './securityMonitor.js';

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

const ipKey = (req: Request): string =>
  ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? '127.0.0.1');

// ── API rate limits (tight) ───────────────────────────────────────────
// Global: 200 req/min per IP for all /api endpoints (down from 300).
export const globalLimiter = failClosed(
  rateLimit({
    windowMs: 60_000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
    },
    keyGenerator: ipKey,
    handler: (_req: Request, _res: Response) => {
      recordRateLimitHit(_req.ip ?? 'unknown', _req.path);
    },
  }),
);

// ── Static/read-only endpoints (generous) ─────────────────────────────
// Health checks, dashboards — need high throughput for uptime monitors.
export const staticLimiter = failClosed(
  rateLimit({
    windowMs: 60_000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
    },
    keyGenerator: ipKey,
  }),
);

// ── Auth-specific limits (very tight) ─────────────────────────────────

// Login: 15 attempts per 15 min per IP. Successes don't count.
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
      handler: (_req: Request, _res: Response) => {
        recordRateLimitHit(_req.ip ?? 'unknown', '/api/auth/login');
      },
    }),
  );
}

// Password-change: 5 attempts per 15 minutes per IP.
export function createPasswordChangeLimiter(options?: {
  windowMs?: number;
  max?: number;
}): Limiter {
  return failClosed(
    rateLimit({
      windowMs: options?.windowMs ?? 15 * 60_000,
      max: options?.max ?? 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many password change attempts. Please try again later.',
        },
      },
      keyGenerator: ipKey,
    }),
  );
}

// Password-reset: 5 requests per 15 minutes per IP.
export function createPasswordResetLimiter(options?: {
  windowMs?: number;
  max?: number;
}): Limiter {
  return failClosed(
    rateLimit({
      windowMs: options?.windowMs ?? 15 * 60_000,
      max: options?.max ?? 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many password reset attempts. Please try again later.',
        },
      },
      keyGenerator: ipKey,
    }),
  );
}
