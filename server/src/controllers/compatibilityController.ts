import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import { compatibilityAddSchema, idParamSchema } from '../validators/catalog.js';
import * as compatibilityService from '../services/compatibilityService.js';

export const listForProduct = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const items = await compatibilityService.listCompatibilityForProduct(id);
  res.json({ items });
});

export const addCompatibility = asyncHandler(async (req: Request, res: Response) => {
  const body = compatibilityAddSchema.parse(req.body);
  const item = await compatibilityService.addCompatibility(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ compatibility: item });
});

export const removeCompatibility = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await compatibilityService.removeCompatibility(id, {
    request: req,
    actor: requireActor(req),
  });
  res.status(204).end();
});