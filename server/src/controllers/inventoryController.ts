import type { Request, Response } from 'express';

import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  idParamSchema,
  inventoryAdjustSchema,
  inventoryListQuery,
  lowStockQuery,
  productIdParamSchema,
  reservationCreateSchema,
  reservationListQuery,
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

export const listReservations = asyncHandler(async (req: Request, res: Response) => {
  const query = reservationListQuery.parse(req.query);
  res.json(await inventoryService.listReservations(query));
});

export const reserve = asyncHandler(async (req: Request, res: Response) => {
  const body = reservationCreateSchema.parse(req.body);
  const actor = requireActor(req);
  const result = await inventoryService.reserve({ ...body, createdById: actor.id, request: req });
  res.status(201).json(result);
});

export const releaseReservation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const actor = requireActor(req);
  const result = await inventoryService.releaseReservation({ reservationId: id, createdById: actor.id, request: req });
  res.json(result);
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