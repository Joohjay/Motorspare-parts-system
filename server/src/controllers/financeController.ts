import type { Request, Response } from 'express';

import * as expenseService from '../services/expenseService.js';
import * as reportsService from '../services/reportsService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireActor } from '../utils/authActor.js';
import {
  expenseCategoryCreateSchema,
  expenseCategoryUpdateSchema,
  expenseCreateSchema,
  expenseListQuery,
  expenseUpdateSchema,
  reportRangeQuery,
} from '../validators/sales.js';
import { idParamSchema } from '../validators/purchasing.js';

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const createExpenseCategory = asyncHandler(async (req: Request, res: Response) => {
  const body = expenseCategoryCreateSchema.parse(req.body);
  const category = await expenseService.createExpenseCategory(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ category });
});

export const updateExpenseCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = expenseCategoryUpdateSchema.parse(req.body);
  const category = await expenseService.updateExpenseCategory(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ category });
});

export const listExpenseCategories = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ items: await expenseService.listExpenseCategories() });
});

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const body = expenseCreateSchema.parse(req.body);
  const expense = await expenseService.createExpense(body, {
    request: req,
    actor: requireActor(req),
  });
  res.status(201).json({ expense });
});

export const updateExpense = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const body = expenseUpdateSchema.parse(req.body);
  const expense = await expenseService.updateExpense(id, body, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ expense });
});

export const voidExpense = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const expense = await expenseService.voidExpense(id, {
    request: req,
    actor: requireActor(req),
  });
  res.json({ expense });
});

export const listExpenses = asyncHandler(async (req: Request, res: Response) => {
  const query = expenseListQuery.parse(req.query);
  res.json(await expenseService.listExpenses(query));
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const salesReport = asyncHandler(async (req: Request, res: Response) => {
  const query = reportRangeQuery.parse(req.query);
  const range = reportsService.resolveRange(query);
  const [summary, payments, daily] = await Promise.all([
    reportsService.salesSummary(range),
    reportsService.paymentMethodTotals(range),
    reportsService.dailySalesSeries(range),
  ]);
  res.json({ range, summary, payments, daily });
});

export const financialReport = asyncHandler(async (req: Request, res: Response) => {
  const query = reportRangeQuery.parse(req.query);
  res.json(await reportsService.financialReport(reportsService.resolveRange(query)));
});

export const expensesReport = asyncHandler(async (req: Request, res: Response) => {
  const query = reportRangeQuery.parse(req.query);
  const range = reportsService.resolveRange(query);
  res.json({ range, ...(await reportsService.expenseSummary(range)) });
});
