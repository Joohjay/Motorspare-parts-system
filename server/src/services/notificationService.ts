import type { Request } from 'express';
import { NotificationType, UserStatus } from '@prisma/client';

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
 * Proactively ensures an out-of-stock notification exists for every ACTIVE user
 * for every product that has no available stock. This catches products that
 * were never in stock (no inventory record) or dropped to zero outside the
 * normal mutation path. Idempotent — skips existing unread notifications.
 */
async function ensureOutOfStockNotifications(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, sku: true },
  });

  const inventories = await prisma.inventory.findMany({
    select: { productId: true, quantityOnHand: true, quantityReserved: true },
  });
  const invMap = new Map(inventories.map((i) => [i.productId, i]));

  const oosProductIds: string[] = [];
  for (const prod of products) {
    const inv = invMap.get(prod.id);
    const available = inv ? inv.quantityOnHand - inv.quantityReserved : 0;
    if (available <= 0) oosProductIds.push(prod.id);
  }

  if (oosProductIds.length === 0) return;

  const users = await prisma.user.findMany({
    where: { status: UserStatus.ACTIVE },
    select: { id: true },
  });

  for (const prod of products) {
    if (!oosProductIds.includes(prod.id)) continue;
    for (const user of users) {
      const existing = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          type: NotificationType.OUT_OF_STOCK,
          readAt: null,
          data: { path: ['productId'], equals: prod.id },
        },
      });
      if (existing) continue;
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: NotificationType.OUT_OF_STOCK,
          title: 'Out of stock',
          message: `${prod.name} (${prod.sku}) is out of stock.`,
          data: { productId: prod.id },
        },
      });
    }
  }
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
  await ensureOutOfStockNotifications();
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
