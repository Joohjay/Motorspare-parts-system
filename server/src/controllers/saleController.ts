import type { Request, Response } from 'express';

import * as salesService from '../services/salesService.js';
import { getCreditAccount } from '../services/customerCreditService.js';
import { getPublicSettings } from '../services/settingsService.js';
import * as salesReturnService from '../services/salesReturnService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  saleCreateSchema,
  saleListQuery,
  saleReturnCreateSchema,
  saleReturnListQuery,
  saleVoidSchema,
} from '../validators/sales.js';
import { idParamSchema } from '../validators/purchasing.js';

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

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export const createSaleReturn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params); // sale id
  const body = saleReturnCreateSchema.parse(req.body);
  const saleReturn = await salesReturnService.createSaleReturn(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ return: saleReturn });
});

export const getSaleReturn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ return: await salesReturnService.getSaleReturn(id) });
});

export const listSaleReturns = asyncHandler(async (req: Request, res: Response) => {
  const query = saleReturnListQuery.parse(req.query);
  res.json(await salesReturnService.listSaleReturns(query));
});

export const getSaleReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const actor = requireActor(req);
  // Role-safe sale projection (ASSISTANT never sees COGS/grossProfit).
  const sale = await salesService.getSale(id, actor.role);
  const [business, credit] = await Promise.all([
    getPublicSettings(),
    sale.customerId
      ? getCreditAccount(sale.customerId)
          .then((account) => ({ outstandingBalance: account.outstandingBalance }))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  res.json({
    receipt: {
      business,
      sale,
      customerCreditOutstanding: credit ? Number(credit.outstandingBalance) : null,
    },
  });
});
