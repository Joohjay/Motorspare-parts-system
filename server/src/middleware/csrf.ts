import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { config } from '../config/env.js';
import { ApiError } from './error.js';

export const CSRF_COOKIE_NAME = 'makire_csrf';

// Mirrors the access-token lifetime configured in env (JWT_EXPIRES_IN=8h).
export const CSRF_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// No state-changing endpoint is exempt. Authentication routes (login, logout,
// forgot/reset password, account status) are CSRF-protected like everything
// else: the client first fetches its token from GET /api/auth/csrf and echoes
// it back in the X-CSRF-Token header.
const CSRF_EXEMPT_PATHS = new Set<string>([]);

export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: CSRF_COOKIE_MAX_AGE,
  };
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Double-submit cookie CSRF protection. The token cookie is issued here when
 * absent so any first request (e.g. GET /api/auth/csrf) establishes it. The
 * client echoes the token in the `X-CSRF-Token` header on every state-changing
 * request. An attacker cannot read or set the victim's cookie, so a forged
 * cross-site request fails the token match. Requests that fail are rejected
 * with 403 CSRF_TOKEN_INVALID.
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  if (!cookies[CSRF_COOKIE_NAME]) {
    res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());
  }
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = Array.isArray(req.headers['x-csrf-token'])
    ? req.headers['x-csrf-token'][0]
    : req.headers['x-csrf-token'];

  if (
    !cookieToken ||
    !headerToken ||
    cookieToken.length !== headerToken.length ||
    !timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))
  ) {
    next(
      new ApiError(
        403,
        'CSRF_TOKEN_INVALID',
        'CSRF token missing or invalid',
      ),
    );
    return;
  }
  next();
}