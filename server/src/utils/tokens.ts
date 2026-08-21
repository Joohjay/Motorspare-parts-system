import { createHash, randomBytes } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { config } from '../config/env.js';

const ISSUER = 'makire-motorparts';
const AUDIENCE = 'makire-motorparts-web';

/**
 * Signs a stateless session token for the given user. Only the user id is
 * carried in the token; role and status are always re-read from the database
 * on every authenticated request so a deactivated or demoted account loses
 * access immediately.
 */
export function signSessionToken(userId: string): string {
  return jwt.sign({}, config.auth.sessionSecret, {
    subject: userId,
    expiresIn: Math.floor(config.auth.sessionTtlMs / 1000),
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Verifies a session token. Returns the user id, or null when the token is
 * missing, malformed, expired, or fails signature/issuer/audience checks.
 */
export function verifySessionToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.auth.sessionSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string' || !payload.sub) return null;
    return payload.sub;
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