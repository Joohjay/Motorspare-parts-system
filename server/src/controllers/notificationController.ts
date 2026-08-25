import type { Request, Response } from 'express';
import { z } from 'zod';

import * as notificationService from '../services/notificationService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';

const listQuerySchema = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const idParamSchema = z.object({ id: z.string().min(1).max(128) });

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const query = listQuerySchema.parse(req.query);
  const actor = requireActor(req);
  res.json(await notificationService.listNotifications(actor.id, query));
});

export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  res.json({ unreadCount: await notificationService.getUnreadCount(actor.id) });
});

export const markNotificationRead = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const actor = requireActor(req);
  res.json({ notification: await notificationService.markNotificationRead(id, { request: req, actor }) });
});

export const markAllNotificationsRead = asyncHandler(async (req: Request, res: Response) => {
  const actor = requireActor(req);
  const updated = await notificationService.markAllNotificationsRead(actor.id);
  res.json({ updatedCount: updated });
});
