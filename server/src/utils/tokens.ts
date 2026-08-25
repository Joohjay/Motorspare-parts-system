import { createHash, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { config } from '../config/env.js';

const ISSUER = 'makire-motorparts';
const AUDIENCE = 'makire-motorparts-web';

/**
 * Signs a stateless session token for the given user. The token carries the
 * user id and a tokenVersion claim. On every authenticated request the
 * middleware re-reads both the user's current status/role and tokenVersion
 * from the database so a revoked token (version mismatch) is rejected
 * immediately.
 */
export function signSessionToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ v: tokenVersion } as object, config.auth.sessionSecret, {
    subject: userId,
    expiresIn: Math.floor(config.auth.sessionTtlMs / 1000),
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Verifies a session token. Returns { userId, tokenVersion } or null when
 * the token is missing, malformed, expired, or fails signature/issuer/audience
 * checks.
 */
export function verifySessionToken(token: string): { userId: string; tokenVersion: number } | null {
  try {
    const payload = jwt.verify(token, config.auth.sessionSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string' || !payload.sub) return null;
    const v = typeof payload.v === 'number' ? payload.v : 0;
    return { userId: payload.sub, tokenVersion: v };
  } catch {
    return null;
  }
}

/**
 * Generates a cryptographically random password-reset token. The raw token is
 * shown to the user exactly once (embedded in a reset link) and is never
 * stored or logged.
 */
export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Stores only the SHA-256 digest of a reset token. If the database is ever
 * leaked, the raw tokens remain unusable.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}