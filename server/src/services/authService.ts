import type { Request } from 'express';
import { UserRole, UserStatus } from '@prisma/client';

import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { hashPassword, validatePassword, verifyPassword, getDummyHash } from '../utils/password.js';
import { generateResetToken, hashResetToken, signSessionToken, verifySessionToken } from '../utils/tokens.js';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
}

export function toSafeUser(user: {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
}): SafeUser {
  return {
    id: user.id,
    name: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
  };
}

export interface LoginResult {
  token: string;
  user: SafeUser;
}

const LOGIN_FAILED = 'Invalid email or password.';

/**
 * Authenticates a user. Every failure returns the exact same error
 * (INVALID_CREDENTIALS) whether the account does not exist, the password is
 * wrong, or the account is inactive — no account enumeration via response
 * body or status code. Timing is equalized with a dummy bcrypt comparison when
 * the account does not exist.
 */
export async function login(
  input: { email: string; password: string },
  ctx: { request: Request },
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await verifyPassword(input.password, await getDummyHash());
    await recordAudit({
      request: ctx.request,
      userId: null,
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: 'unknown',
    });
    throw new ApiError(401, 'INVALID_CREDENTIALS', LOGIN_FAILED);
  }

  const passwordOk = await verifyPassword(input.password, user.passwordHash);

  if (!passwordOk || user.status !== UserStatus.ACTIVE) {
    await recordAudit({
      request: ctx.request,
      userId: user.id,
      action: 'LOGIN_FAILED',
      entityType: 'user',
      entityId: user.id,
    });
    throw new ApiError(401, 'INVALID_CREDENTIALS', LOGIN_FAILED);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordAudit({
    request: ctx.request,
    userId: user.id,
    action: 'LOGIN_SUCCESS',
    entityType: 'user',
    entityId: user.id,
  });

  return { token: signSessionToken(user.id), user: toSafeUser(user) };
}

/** Returns the currently authenticated user (already loaded fresh by requireAuth). */
export function getCurrentUser(authUser: {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
}): SafeUser {
  return toSafeUser(authUser);
}

/**
 * Logs the user out. For a stateless token session this means clearing the
 * httpOnly cookie; the audit trail records the logout while the token was
 * still valid.
 */
export async function logout(ctx: { request: Request }): Promise<void> {
  const cookies = (ctx.request.cookies ?? {}) as Record<string, string | undefined>;
  const token = cookies[config.auth.sessionCookieName];
  let userId: string | null = null;
  if (typeof token === 'string' && token.length > 0) {
    userId = verifySessionToken(token);
  }
  await recordAudit({
    request: ctx.request,
    userId,
    action: 'LOGOUT',
    entityType: 'user',
    entityId: userId ?? 'unknown',
  });
}

/**
 * Requests a password reset. The response is identical whether or not the
 * email exists, preventing account enumeration. A reset token is only issued
 * to ACTIVE accounts. In development the reset URL is logged (never in
 * production) so the flow can be exercised without an SMTP server.
 */
export async function requestPasswordReset(
  input: { email: string },
  ctx: { request: Request },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    if (user.status === UserStatus.ACTIVE) {
      const rawToken = generateResetToken();
      const tokenHash = hashResetToken(rawToken);

      // Invalidate any previous outstanding tokens so only the latest link
      // works (single active token per user).
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + config.auth.resetTokenTtlMs),
        },
      });

      await recordAudit({
        request: ctx.request,
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'user',
        entityId: user.id,
      });

      if (config.isDevelopment) {
        const url = `${config.auth.resetUrl}?token=${rawToken}`;
        logger.info('password_reset_link', { url });
      }
    } else {
      // Account exists but is inactive: do not issue a token, and do not tell
      // the caller why.
      await recordAudit({
        request: ctx.request,
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'user',
        entityId: user.id,
      });
    }
  }

  // Identical response in every case.
}

/**
 * Completes a password reset. Tokens are single-use and expire; only the SHA-256
 * hash of the token is stored. All outstanding tokens for the user are
 * invalidated on success so a reused link can never be honored twice.
 */
export async function resetPassword(
  input: { token: string; password: string },
  ctx: { request: Request },
): Promise<void> {
  const tokenHash = hashResetToken(input.token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  const invalid = () =>
    new ApiError(
      400,
      'INVALID_TOKEN',
      'This password reset link is invalid or has expired. Request a new one.',
    );

  if (!record || record.usedAt !== null || record.expiresAt <= new Date()) {
    throw invalid();
  }
  if (record.user.status !== UserStatus.ACTIVE) {
    throw invalid();
  }

  const policyError = validatePassword(input.password, record.user.email);
  if (policyError) {
    throw new ApiError(400, 'INVALID_PASSWORD', policyError);
  }

  const newPasswordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: newPasswordHash },
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  await recordAudit({
    request: ctx.request,
    userId: record.userId,
    action: 'PASSWORD_RESET_COMPLETED',
    entityType: 'user',
    entityId: record.userId,
  });
}

export type AccountStatusInput = 'ACTIVE' | 'INACTIVE';

/**
 * Activates or deactivates a user account (ADMIN only). Guards against the
 * final ADMIN being deactivated and against an ADMIN deactivating themselves.
 */
export async function setAccountStatus(
  targetUserId: string,
  status: AccountStatusInput,
  ctx: { request: Request; actor: { id: string } },
): Promise<SafeUser> {
  if (ctx.actor.id === targetUserId && status === UserStatus.INACTIVE) {
    throw new ApiError(
      400,
      'CANNOT_DEACTIVATE_SELF',
      'You cannot deactivate your own account.',
    );
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    throw ApiError.notFound('User not found');
  }

  if (status === UserStatus.INACTIVE && target.role === UserRole.ADMIN) {
    const activeAdmins = await prisma.user.count({
      where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
    });
    if (activeAdmins <= 1) {
      throw new ApiError(
        400,
        'FINAL_ADMIN_PROTECTION',
        'Cannot deactivate the last active administrator.',
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { status },
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: status === UserStatus.ACTIVE ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED',
    entityType: 'user',
    entityId: targetUserId,
    afterState: { status },
  });

  return toSafeUser(updated);
}