import type { Request, Response } from 'express';
import { z } from 'zod';

import * as settingsService from '../services/settingsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';

const settingsUpdateSchema = z
  .record(z.string().trim().max(500))
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one setting')
  .refine(
    (v) => Object.keys(v).every((key) => settingsService.PUBLIC_KEYS.includes(key)),
    'Unknown or protected setting key',
  );

export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ settings: await settingsService.getPublicSettings() });
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const body = settingsUpdateSchema.parse(req.body);
  const settings = await settingsService.updateSettings(body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ settings });
});
