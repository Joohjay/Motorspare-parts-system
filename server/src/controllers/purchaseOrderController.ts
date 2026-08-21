import type { Request, Response } from 'express';

import * as purchaseOrderService from '../services/purchaseOrderService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  idParamSchema,
  purchaseOrderCreateSchema,
  purchaseOrderListQuery,
  purchaseOrderUpdateSchema,
} from '../validators/purchasing.js';

export const listPurchaseOrders = asyncHandler(async (req: Request, res: Response) => {
  const query = purchaseOrderListQuery.parse(req.query);
  res.json(await purchaseOrderService.listPurchaseOrders(query));
});

export const getPurchaseOrder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ purchaseOrder: await purchaseOrderService.getPurchaseOrder(id) });
});

export const createPurchaseOrder = asyncHandler(async (req: Request, res: Response) => {
  const body = purchaseOrderCreateSchema.parse(req.body);
  const order = await purchaseOrderService.createPurchaseOrder(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ purchaseOrder: order });
});

export const updatePurchaseOrder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = purchaseOrderUpdateSchema.parse(req.body);
  const order = await purchaseOrderService.updatePurchaseOrder(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ purchaseOrder: order });
});

export const submitPurchaseOrder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const order = await purchaseOrderService.submitPurchaseOrder(id, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ purchaseOrder: order });
});

export const cancelPurchaseOrder = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const order = await purchaseOrderService.cancelPurchaseOrder(id, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ purchaseOrder: order });
});