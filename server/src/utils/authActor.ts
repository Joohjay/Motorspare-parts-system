import type { Request } from 'express';

import { ApiError } from '../middleware/error.js';

/** Resolves the authenticated actor id; throws if the request is not authenticated. */
export function requireActor(req: Request): { id: string; role: 'ADMIN' | 'ASSISTANT' } {
  if (!req.authUser) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
  }
  return { id: req.authUser.id, role: req.authUser.role };
}