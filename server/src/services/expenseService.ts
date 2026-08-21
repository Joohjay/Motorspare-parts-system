import { ExpenseStatus, PaymentMethod, Prisma } from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { paginate } from '../utils/pagination.js';

export interface Actor {
  id: string;
}

export interface Context {
  request?: Request;
  actor?: Actor;
}

function audit(input: {
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  context: Context;
}): void {
  void recordAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeState: input.beforeState as never,
    afterState: input.afterState as never,
    request: input.context.request,
    userId: input.context.actor?.id,
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createExpenseCategory(
  body: { name: string; description?: string | null },
  context: Context,
) {
  const existing = await prisma.expenseCategory.findUnique({
    where: { name: body.name },
  });
  if (existing) {
    throw new ApiError(409, 'EXPENSE_CATEGORY_EXISTS', 'An expense category with this name already exists');
  }
  const category = await prisma.expenseCategory.create({
    data: { name: body.name, description: body.description ?? null },
  });
  audit({
    action: AUDIT.EXPENSE_CATEGORY_CREATED,
    entityType: 'ExpenseCategory',
    entityId: category.id,
    afterState: { name: category.name },
    context,
  });
  return category;
}

export async function updateExpenseCategory(
  categoryId: string,
  body: { name?: string; description?: string | null },
  context: Context,
) {
  const existing = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!existing) throw ApiError.notFound('Expense category not found');

  if (body.name && body.name !== existing.name) {
    const clash = await prisma.expenseCategory.findUnique({ where: { name: body.name } });
    if (clash) {
      throw new ApiError(409, 'EXPENSE_CATEGORY_EXISTS', 'An expense category with this name already exists');
    }
  }

  const category = await prisma.expenseCategory.update({
    where: { id: categoryId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
    },
  });
  audit({
    action: AUDIT.EXPENSE_CATEGORY_UPDATED,
    entityType: 'ExpenseCategory',
    entityId: category.id,
    beforeState: { name: existing.name, description: existing.description },
    afterState: { name: category.name, description: category.description },
    context,
  });
  return category;
}

export async function listExpenseCategories() {
  return prisma.expenseCategory.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { expenses: true } } },
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

async function requireCategory(categoryId: string) {
  const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw ApiError.notFound('Expense category not found');
  return category;
}

export async function createExpense(
  body: {
    categoryId: string;
    amount: number;
    expenseDate?: string;
    description?: string | null;
    reference?: string | null;
    paymentMethod?: PaymentMethod | null;
  },
  context: Context,
) {
  await requireCategory(body.categoryId);
  const amount = new Prisma.Decimal(String(body.amount));

  const expense = await prisma.expense.create({
    data: {
      categoryId: body.categoryId,
      amount,
      expenseDate: body.expenseDate ? new Date(body.expenseDate) : new Date(),
      description: body.description ?? null,
      reference: body.reference ?? null,
      paymentMethod: body.paymentMethod ?? null,
      status: ExpenseStatus.ACTIVE,
      createdById: context.actor!.id,
    },
    include: { category: { select: { id: true, name: true } }, createdBy: { select: { id: true, fullName: true } } },
  });

  audit({
    action: AUDIT.EXPENSE_CREATED,
    entityType: 'Expense',
    entityId: expense.id,
    afterState: { amount: Number(amount), categoryId: body.categoryId, method: body.paymentMethod ?? null },
    context,
  });
  return serializeExpense(expense);
}

export async function updateExpense(
  expenseId: string,
  body: Partial<{
    categoryId: string;
    amount: number;
    expenseDate: string;
    description: string | null;
    reference: string | null;
    paymentMethod: PaymentMethod | null;
  }>,
  context: Context,
) {
  const existing = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!existing) throw ApiError.notFound('Expense not found');
  if (existing.status === ExpenseStatus.VOIDED) {
    throw new ApiError(409, 'EXPENSE_VOIDED', 'A voided expense cannot be edited');
  }
  if (body.categoryId) await requireCategory(body.categoryId);

  const expense = await prisma.expense.update({
    where: { id: expenseId },
    data: {
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.amount !== undefined ? { amount: new Prisma.Decimal(String(body.amount)) } : {}),
      ...(body.expenseDate !== undefined ? { expenseDate: new Date(body.expenseDate) } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.reference !== undefined ? { reference: body.reference } : {}),
      ...(body.paymentMethod !== undefined ? { paymentMethod: body.paymentMethod } : {}),
    },
    include: { category: { select: { id: true, name: true } }, createdBy: { select: { id: true, fullName: true } } },
  });

  audit({
    action: AUDIT.EXPENSE_UPDATED,
    entityType: 'Expense',
    entityId: expense.id,
    beforeState: { amount: Number(existing.amount), categoryId: existing.categoryId },
    afterState: { amount: Number(expense.amount), categoryId: expense.categoryId },
    context,
  });
  return serializeExpense(expense);
}

/** Voids an expense (ADMIN-only at the route). Financial records are never deleted. */
export async function voidExpense(expenseId: string, context: Context) {
  const existing = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!existing) throw ApiError.notFound('Expense not found');
  if (existing.status === ExpenseStatus.VOIDED) {
    throw new ApiError(409, 'EXPENSE_ALREADY_VOIDED', 'Expense has already been voided');
  }

  const expense = await prisma.expense.update({
    where: { id: expenseId },
    data: { status: ExpenseStatus.VOIDED },
    include: { category: { select: { id: true, name: true } }, createdBy: { select: { id: true, fullName: true } } },
  });

  audit({
    action: AUDIT.EXPENSE_VOIDED,
    entityType: 'Expense',
    entityId: expense.id,
    beforeState: { status: existing.status },
    afterState: { status: ExpenseStatus.VOIDED },
    context,
  });
  return serializeExpense(expense);
}

function serializeExpense(expense: {
  id: string;
  amount: Prisma.Decimal;
  expenseDate: Date;
  description: string | null;
  reference: string | null;
  paymentMethod: PaymentMethod | null;
  status: ExpenseStatus;
  category: { id: string; name: string };
  createdBy: { id: string; fullName: string };
  createdAt: Date;
}) {
  return {
    id: expense.id,
    categoryId: expense.category.id,
    categoryName: expense.category.name,
    amount: expense.amount.toFixed(2),
    expenseDate: expense.expenseDate,
    description: expense.description,
    reference: expense.reference,
    paymentMethod: expense.paymentMethod,
    status: expense.status,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt,
  };
}

export async function listExpenses(
  query: {
    categoryId?: string;
    status?: 'ACTIVE' | 'VOIDED';
    from?: string;
    to?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  },
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const where: Prisma.ExpenseWhereInput = {};
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    where.expenseDate = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  const sortBy = query.sortBy ?? 'expenseDate';

  const [totalItems, rows] = await Promise.all([
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: [{ [sortBy]: query.sortOrder ?? 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(rows.map(serializeExpense), page, pageSize, totalItems);
}
