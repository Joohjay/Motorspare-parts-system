import type { Request, Response } from 'express';

import * as purchaseReturnService from '../services/purchaseReturnService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  idParamSchema,
  purchaseReturnCreateSchema,
  purchaseReturnListQuery,
} from '../validators/purchasing.js';

export const createPurchaseReturn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = purchaseReturnCreateSchema.parse(req.body);
  const saleReturn = await purchaseReturnService.createPurchaseReturn(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ return: saleReturn });
});

export const cancelPurchaseReturn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json(await purchaseReturnService.cancelPurchaseReturn(id, { request: req, actor: requireActor(req) }));
});

export const getPurchaseReturn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ return: await purchaseReturnService.getPurchaseReturn(id) });
});

export const listPurchaseReturns = asyncHandler(async (req: Request, res: Response) => {
  const query = purchaseReturnListQuery.parse(req.query);
  res.json(await purchaseReturnService.listPurchaseReturns(query));
});
