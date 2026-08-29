import type { Request, Response } from 'express';

import * as salesService from '../services/salesService.js';
import { getPublicSettings } from '../services/settingsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  saleCreateSchema,
  saleListQuery,
  saleVoidSchema,
} from '../validators/sales.js';
import { idParamSchema } from '../validators/catalog.js';

export const createSale = asyncHandler(async (req: Request, res: Response) => {
  const body = saleCreateSchema.parse(req.body);
  const actor = requireActor(req);
  const sale = await salesService.createSale(body, { request: req, actor });
  res.status(201).json({ sale });
});

export const getSale = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const actor = requireActor(req);
  res.json({ sale: await salesService.getSale(id, actor.role) });
});

export const listSales = asyncHandler(async (req: Request, res: Response) => {
  const query = saleListQuery.parse(req.query);
  res.json(await salesService.listSales(query));
});

export const voidSale = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = saleVoidSchema.parse(req.body);
  const result = await salesService.voidSale(id, body.reason, {
    request: req,
    actor: requireActor(req),
  });
  res.json(result);
});

export const getSaleReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const actor = requireActor(req);
  // Role-safe sale projection (ASSISTANT never sees COGS/grossProfit).
  const sale = await salesService.getSale(id, actor.role);
  const business = await getPublicSettings();
  res.json({
    receipt: {
      business,
      sale,
    },
  });
});
