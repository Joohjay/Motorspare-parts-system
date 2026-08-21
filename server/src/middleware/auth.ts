import type { NextFunction, Request, Response } from 'express';
import { UserRole, UserStatus } from '@prisma/client';

import { config } from '../config/env.js';
import prisma from '../lib/prisma.js';
import { verifySessionToken } from '../utils/tokens.js';
import { ApiError } from './error.js';

export const SESSION_COOKIE_NAME = config.auth.sessionCookieName;

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: Date | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by requireAuth/requireAdmin. Never trust client input for role. */
    authUser?: AuthUser;
  }
}

function sessionTokenFrom(req: Request): string | null {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const token = cookies[SESSION_COOKIE_NAME];
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Loads the user from the database for a session token. The role and status are
 * always read from the server-side record — never from the token or the client —
 * so deactivated accounts are locked out on their very next request.
 */
async function loadAuthUser(token: string): Promise<AuthUser> {
  const userId = verifySessionToken(token);
  if (!userId) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
  }
  if (user.status !== UserStatus.ACTIVE) {
    throw new ApiError(403, 'ACCOUNT_INACTIVE', 'Account is inactive');
  }
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
  };
}

/** Any authenticated, ACTIVE user. */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = sessionTokenFrom(req);
  if (!token) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
  }
  req.authUser = await loadAuthUser(token);
  next();
}

/** ADMIN-only access. Operationally the least-privilege boundary for assistants. */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = sessionTokenFrom(req);
  if (!token) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
  }
  const authUser = await loadAuthUser(token);
  if (authUser.role !== UserRole.ADMIN) {
    throw new ApiError(403, 'FORBIDDEN', 'Administrator access required');
  }
  req.authUser = authUser;
  next();
}