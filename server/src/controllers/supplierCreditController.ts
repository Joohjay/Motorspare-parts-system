import type { Request, Response } from 'express';

import * as supplierCreditService from '../services/supplierCreditService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  creditPaymentCreateSchema,
  creditPaymentsListQuery,
  idParamSchema,
} from '../validators/purchasing.js';

export const openCreditAccount = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const account = await supplierCreditService.openCreditAccount(id, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ creditAccount: account });
});

export const getCreditAccount = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const account = await supplierCreditService.getCreditAccount(id);
  res.json({ creditAccount: account });
});

export const listCreditPayments = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const query = creditPaymentsListQuery.parse(req.query);
  res.json(await supplierCreditService.listCreditPayments(id, query));
});

export const recordCreditPayment = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = creditPaymentCreateSchema.parse(req.body);
  const { payment, creditAccount } = await supplierCreditService.recordCreditPayment(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ payment, creditAccount });
});