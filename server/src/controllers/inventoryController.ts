import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  inventoryAdjustSchema,
  inventoryListQuery,
  lowStockQuery,
  productIdParamSchema,
  transactionListQuery,
} from '../validators/inventory.js';
import * as inventoryService from '../services/inventoryService.js';

export const listInventory = asyncHandler(async (req: Request, res: Response) => {
  const query = inventoryListQuery.parse(req.query);
  res.json(await inventoryService.listInventory(query));
});

export const listLowStock = asyncHandler(async (req: Request, res: Response) => {
  const query = lowStockQuery.parse(req.query);
  res.json(await inventoryService.listLowStock(query));
});

export const getInventory = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = productIdParamSchema.parse(req.params);
  res.json({ inventory: await inventoryService.getInventory(productId) });
});

export const listTransactions = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = productIdParamSchema.parse(req.params);
  const query = transactionListQuery.parse(req.query);
  res.json(await inventoryService.listTransactions(productId, query));
});

export const adjust = asyncHandler(async (req: Request, res: Response) => {
  const { productId } = productIdParamSchema.parse(req.params);
  const body = inventoryAdjustSchema.parse(req.body);
  const actor = requireActor(req);
  const result = await inventoryService.adjust({
    productId,
    quantity: body.quantity,
    reason: body.reason,
    type: body.type,
    createdById: actor.id,
    request: req,
  });
  res.json(result);
});