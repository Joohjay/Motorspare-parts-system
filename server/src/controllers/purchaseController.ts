import type { Request, Response } from 'express';

import * as purchaseReceivingService from '../services/purchaseReceivingService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  idParamSchema,
  purchaseCreateSchema,
  purchaseListQuery,
} from '../validators/purchasing.js';

export const listPurchases = asyncHandler(async (req: Request, res: Response) => {
  const query = purchaseListQuery.parse(req.query);
  res.json(await purchaseReceivingService.listPurchases(query));
});

export const getPurchase = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ purchase: await purchaseReceivingService.getPurchase(id) });
});

export const createPurchase = asyncHandler(async (req: Request, res: Response) => {
  const body = purchaseCreateSchema.parse(req.body);
  const purchase = await purchaseReceivingService.createPurchase(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ purchase });
});