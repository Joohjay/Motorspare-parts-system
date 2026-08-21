import type { Request, Response } from 'express';

import * as customerService from '../services/customerService.js';
import * as customerCreditService from '../services/customerCreditService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  creditLimitSchema,
  creditPaymentsListQuery,
  customerCreateSchema,
  customerCreditPaymentCreateSchema,
  customerListQuery,
  customerStatusSchema,
  customerUpdateSchema,
  statementQuery,
} from '../validators/sales.js';
import { idParamSchema } from '../validators/purchasing.js';

export const createCustomer = asyncHandler(async (req: Request, res: Response) => {
  const body = customerCreateSchema.parse(req.body);
  const customer = await customerService.createCustomer(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ customer });
});

export const updateCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = customerUpdateSchema.parse(req.body);
  const customer = await customerService.updateCustomer(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ customer });
});

export const setCustomerStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { status } = customerStatusSchema.parse(req.body);
  const customer = await customerService.setCustomerStatus(id, status, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ customer });
});

export const listCustomers = asyncHandler(async (req: Request, res: Response) => {
  const query = customerListQuery.parse(req.query);
  res.json(await customerService.listCustomers(query));
});

export const getCustomer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ customer: await customerService.getCustomer(id) });
});

// ---------------------------------------------------------------------------
// Customer credit
// ---------------------------------------------------------------------------

export const openCreditAccount = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const account = await customerCreditService.openCreditAccount(id, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ creditAccount: account });
});

export const getCreditAccount = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.json({ creditAccount: await customerCreditService.getCreditAccount(id) });
});

export const setCreditLimit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = creditLimitSchema.parse(req.body);
  const account = await customerCreditService.setCreditLimit(id, body.creditLimit, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ creditAccount: account });
});

export const recordCreditPayment = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = customerCreditPaymentCreateSchema.parse(req.body);
  const result = await customerCreditService.recordCreditPayment(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({
    payment: result.payment,
    newBalance: result.newBalance.toFixed(2),
  });
});

export const listCreditPayments = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const query = creditPaymentsListQuery.parse(req.query);
  res.json(await customerCreditService.listCreditPayments(id, query));
});

export const getStatement = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const query = statementQuery.parse(req.query);
  res.json(await customerCreditService.getStatement(id, query));
});
