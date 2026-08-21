import { randomBytes } from 'node:crypto';

import { compare, hash } from 'bcryptjs';

import { config } from '../config/env.js';

export const PASSWORD_MIN_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return hash(password, config.auth.bcryptCost);
}

export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return compare(password, storedHash);
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Hash of a random throwaway password at the configured cost. Comparing the
 * supplied password against this dummy hash when a user does not exist keeps
 * login timing roughly constant and prevents account enumeration by response
 * time. The value is never used to verify anything.
 */
export function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash(randomBytes(32).toString('hex'), config.auth.bcryptCost);
  return dummyHashPromise;
}

/**
 * Password policy. Returns a human-readable failure reason, or null when the
 * password is acceptable. The same policy applies to password reset and to any
 * future account-creation flow — it must never be weakened for one path.
 */
export function validatePassword(password: string, email?: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  if (/^(.)\1{7,}$/.test(password)) {
    return 'Password is too predictable. Choose a less repetitive password.';
  }
  const emailPrefix = email?.split('@')[0]?.toLowerCase();
  if (emailPrefix && emailPrefix.length >= 4 && password.toLowerCase().includes(emailPrefix)) {
    return 'Password must not contain your email address.';
  }
  return null;
}