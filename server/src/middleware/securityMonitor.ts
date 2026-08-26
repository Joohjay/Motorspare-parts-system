import { logger } from '../lib/logger.js';

/**
 * Lightweight in-memory security event tracker. Detects patterns that
 * indicate brute-force, credential-stuffing, or other attacks, and logs
 * structured warnings at `warn` level so any log shipper / monitoring
 * tool can pick them up.
 *
 * Resets counters every WINDOW_MS so sustained slow attacks don't
 * accumulate forever.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_FAIL_THRESHOLD = 10; // per IP per window
const RATE_LIMIT_HIT_THRESHOLD = 20; // per IP per window
const RESET_THRESHOLD = 50; // password reset requests per IP per window

interface WindowCounter {
  count: number;
  windowStart: number;
}

const loginFails = new Map<string, WindowCounter>();
const rateLimitHits = new Map<string, WindowCounter>();
const resetRequests = new Map<string, WindowCounter>();

function track(counter: Map<string, WindowCounter>, key: string): number {
  const now = Date.now();
  const entry = counter.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    counter.set(key, { count: 1, windowStart: now });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

export function recordLoginFailure(ip: string, email: string): void {
  const count = track(loginFails, ip);
  if (count === LOGIN_FAIL_THRESHOLD) {
    logger.warn('SECURITY: Brute-force threshold reached', {
      event: 'brute_force_detected',
      ip,
      email,
      failedAttempts: count,
      windowMinutes: WINDOW_MS / 60_000,
    });
  }
  if (count >= LOGIN_FAIL_THRESHOLD && count % 5 === 0) {
    logger.warn('SECURITY: Sustained brute-force attempt', {
      event: 'brute_force_ongoing',
      ip,
      email,
      failedAttempts: count,
    });
  }
}

export function recordRateLimitHit(ip: string, path: string): void {
  const count = track(rateLimitHits, ip);
  if (count === RATE_LIMIT_HIT_THRESHOLD) {
    logger.warn('SECURITY: Rate limit abuse detected', {
      event: 'rate_limit_abuse',
      ip,
      path,
      hitCount: count,
    });
  }
}

export function recordPasswordResetRequest(ip: string, email: string): void {
  const count = track(resetRequests, ip);
  if (count >= RESET_THRESHOLD) {
    logger.warn('SECURITY: Excessive password reset requests', {
      event: 'excessive_password_reset',
      ip,
      email,
      requestCount: count,
    });
  }
}

/**
 * Returns a snapshot of current security counters. Useful for a future
 * admin security dashboard.
 */
export function getSecuritySnapshot(): {
  loginFails: number;
  rateLimitHits: number;
  resetRequests: number;
} {
  return {
    loginFails: loginFails.size,
    rateLimitHits: rateLimitHits.size,
    resetRequests: resetRequests.size,
  };
}
