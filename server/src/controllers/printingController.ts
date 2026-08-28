import type { Request, Response } from 'express';

import * as printingService from '../services/printingService.js';
import { getPublicSettings, getSettingValue } from '../services/settingsService.js';
import * as salesService from '../services/salesService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import { idParamSchema } from '../validators/purchasing.js';

export const listPrinters = asyncHandler(async (_req: Request, res: Response) => {
  requireActor(_req);
  res.json({ printers: await printingService.listPrinters() });
});

export const printSaleReceipt = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const actor = requireActor(req);

  const sale = await salesService.getSale(id, actor.role);
  const business = await getPublicSettings();

  const printer = (await getSettingValue('printing.receiptPrinter')) ?? '';
  const mode = ((await getSettingValue('printing.receiptMode')) ?? 'thermal') as printingService.ReceiptMode;
  const width = Number((await getSettingValue('printing.receiptWidth')) ?? 42) || 42;

  await printingService.printReceipt({ business, sale }, { printer, mode, width });
  res.json({ printed: true, printer, mode });
});