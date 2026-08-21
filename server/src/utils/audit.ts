import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export interface AuditEventInput {
  request?: Request;
  userId?: string | null;
  /** Stable event code, e.g. LOGIN_SUCCESS, ACCOUNT_DEACTIVATED. */
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
}

/**
 * Writes a security audit record. Never pass passwords, password hashes, or
 * raw reset tokens here — those must not be persisted in audit logs.
 *
 * Audit writes are best-effort: an audit failure must never fail the
 * originating request, so errors are logged and swallowed.
 */
export async function recordAudit(input: AuditEventInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        requestId: String(input.request?.headers['x-request-id'] ?? ''),
        ipAddress: input.request?.ip ?? input.request?.socket.remoteAddress ?? null,
      },
    });
  } catch (err) {
    logger.error('audit_log_write_failed', {
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}