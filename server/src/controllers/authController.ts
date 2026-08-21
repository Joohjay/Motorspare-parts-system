import type { Request, Response } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../utils/asyncHandler.js';
import { SESSION_COOKIE_NAME } from '../middleware/auth.js';
import { CSRF_COOKIE_NAME, generateCsrfToken, csrfCookieOptions } from '../middleware/csrf.js';
import { ApiError } from '../middleware/error.js';
import { config } from '../config/env.js';
import { UserStatus } from '@prisma/client';
import * as authService from '../services/authService.js';

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: config.auth.sessionTtlMs,
  };
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1024),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(1024),
  password: z.string().min(1).max(1024),
});

const accountStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

export const getCsrfToken = asyncHandler(async (req: Request, res: Response) => {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  const existing = cookies[CSRF_COOKIE_NAME];
  const token = typeof existing === 'string' && existing.length > 0 ? existing : generateCsrfToken();
  if (!existing) {
    res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  }
  res.json({ csrfToken: token });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);
  const result = await authService.login(body, { request: req });
  res.cookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions());
  res.json({ user: result.user });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout({ request: req });
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
  });
  res.status(204).end();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
  }
  res.json({ user: authService.getCurrentUser(req.authUser) });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const body = forgotPasswordSchema.parse(req.body);
  await authService.requestPasswordReset(body, { request: req });
  res.json({
    message:
      'If an account exists for that email, a password reset link has been sent.',
  });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const body = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(body, { request: req });
  res.json({
    message: 'Your password has been reset. You can now sign in.',
  });
});

export const updateAccountStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.authUser) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
  }
  const { id } = req.params as { id: string };
  const body = accountStatusSchema.parse(req.body);
  const user = await authService.setAccountStatus(id, body.status as UserStatus, {
    request: req,
    actor: { id: req.authUser.id },
  });
  res.json({ user });
});