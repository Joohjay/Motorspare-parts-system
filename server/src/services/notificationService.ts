import type { Request } from 'express';

import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { paginate } from '../utils/pagination.js';

export interface Actor {
  id: string;
}

export interface Context {
  request?: Request;
  actor?: Actor;
}

/**
 * Per-user notification inbox (Stage 8). Notifications are created by
 * domain events (inventory thresholds, credit due dates, pending documents)
 * and are strictly private to their recipient.
 */
export async function listNotifications(
  userId: string,
  query: {
    unreadOnly?: boolean;
    page?: number;
    pageSize?: number;
  },
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const where = { userId, ...(query.unreadOnly ? { readAt: null } : {}) };

  const [totalItems, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(rows, page, pageSize, totalItems);
}

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationRead(notificationId: string, context: Context) {
  const existing = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!existing || existing.userId !== context.actor!.id) {
    throw ApiError.notFound('Notification not found');
  }
  if (existing.readAt) return existing;

  return prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
