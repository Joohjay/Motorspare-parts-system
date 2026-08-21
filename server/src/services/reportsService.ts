import { PaymentMethod, Prisma, SaleStatus, ExpenseStatus } from '@prisma/client';

import prisma from '../lib/prisma.js';

function decimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(String(value));
}

/**
 * Resolves the report date range. Presets are computed in Africa/Dar_es_Salaam
 * terms via plain UTC day boundaries (the shop operates in a single timezone;
 * DST does not exist in Tanzania so UTC+3 fixed offset is safe).
 */
export function resolveRange(query: { preset?: 'today' | 'yesterday' | 'this_week' | 'this_month'; from?: string; to?: string }): { from: Date; to: Date } {
  const TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // EAT (UTC+3)

  const startOfLocalDay = (utcMs: number): Date => {
    const local = new Date(utcMs + TZ_OFFSET_MS);
    local.setUTCHours(0, 0, 0, 0);
    return new Date(local.getTime() - TZ_OFFSET_MS);
  };

  if (query.preset) {
    const nowLocal = startOfLocalDay(Date.now());
    switch (query.preset) {
      case 'today':
        return { from: nowLocal, to: new Date(nowLocal.getTime() + 24 * 3600 * 1000) };
      case 'yesterday': {
        const from = new Date(nowLocal.getTime() - 24 * 3600 * 1000);
        return { from, to: nowLocal };
      }
      case 'this_week': {
        const weekday = (nowLocal.getUTCDay() + 6) % 7; // Monday = 0
        const from = new Date(nowLocal.getTime() - weekday * 24 * 3600 * 1000);
        return { from, to: new Date(from.getTime() + 7 * 24 * 3600 * 1000) };
      }
      case 'this_month': {
        const local = new Date(nowLocal.getTime() + TZ_OFFSET_MS);
        const first = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1));
        return { from: new Date(first.getTime() - TZ_OFFSET_MS), to: new Date(first.getTime() + 31 * 24 * 3600 * 1000) };
      }
    }
  }

  const from = new Date(query.from!);
  const to = new Date(query.to!);
  if (to < from) {
    const swappedTo = from;
    return { from: to, to: swappedTo };
  }
  return { from, to };
}

const money = (value: Prisma.Decimal | number | null | undefined): string => decimal(value ?? 0).toFixed(2);

export interface SalesSummary {
  saleCount: number;
  revenue: string;
  cogs: string;
  grossProfit: string;
  discounts: string;
}

/** Sales aggregates over completed sales only. COGS uses frozen line costs. */
export async function salesSummary(range: { from: Date; to: Date }): Promise<SalesSummary> {
  const totals = await prisma.sale.aggregate({
    where: { status: SaleStatus.COMPLETED, createdAt: { gte: range.from, lt: range.to } },
    _count: { _all: true },
    _sum: { totalAmount: true, discount: true },
  });
  const cogs = await prisma.saleItem.aggregate({
    where: { sale: { status: SaleStatus.COMPLETED, createdAt: { gte: range.from, lt: range.to } } },
    _sum: { lineCost: true },
  });

  const revenue = decimal(totals?._sum.totalAmount ?? 0);
  const cost = decimal(cogs?._sum.lineCost ?? 0);
  return {
    saleCount: totals?._count._all ?? 0,
    revenue: money(revenue),
    cogs: money(cost),
    grossProfit: money(revenue.sub(cost)),
    discounts: money(totals?._sum.discount ?? 0),
  };
}

export async function paymentMethodTotals(range: { from: Date; to: Date }) {
  const rows = await prisma.payment.groupBy({
    by: ['paymentMethod'],
    where: { sale: { status: SaleStatus.COMPLETED }, createdAt: { gte: range.from, lt: range.to } },
    _sum: { amount: true },
    orderBy: { paymentMethod: 'asc' },
  });
  return rows.map((row) => ({
    paymentMethod: row.paymentMethod as PaymentMethod,
    total: money(row._sum.amount),
  }));
}

export async function dailySalesSeries(range: { from: Date; to: Date }) {
  const rows = await prisma.$queryRaw<Array<{ day: Date; revenue: Prisma.Decimal; orders: bigint }>>(
    Prisma.sql`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Africa/Nairobi') AS day,
             SUM("totalAmount") AS revenue,
             COUNT(*)::bigint AS orders
      FROM "sales"
      WHERE "status" = 'COMPLETED' AND "createdAt" >= ${range.from} AND "createdAt" < ${range.to}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  );
  return rows.map((row) => ({
    date: row.day,
    revenue: money(row.revenue),
    orders: Number(row.orders),
  }));
}

export async function creditSummary() {
  const agg = await prisma.customerCreditAccount.aggregate({
    where: { status: 'ACTIVE' },
    _count: { _all: true },
    _sum: { outstandingBalance: true, creditLimit: true },
  });
  const topDebtors = await prisma.customerCreditAccount.findMany({
    where: { status: 'ACTIVE', outstandingBalance: { gt: 0 } },
    orderBy: { outstandingBalance: 'desc' },
    take: 10,
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
  return {
    activeAccounts: agg?._count._all ?? 0,
    totalOutstanding: money(agg?._sum.outstandingBalance),
    totalCreditLimit: money(agg?._sum.creditLimit),
    topDebtors: topDebtors.map((account) => ({
      customerId: account.customerId,
      name: account.customer.name,
      phone: account.customer.phone,
      outstandingBalance: money(account.outstandingBalance),
      creditLimit: money(account.creditLimit),
    })),
  };
}

export async function returnsSummary(range: { from: Date; to: Date }) {
  const agg = await prisma.saleReturn.aggregate({
    where: { status: 'COMPLETED', returnDate: { gte: range.from, lt: range.to } },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  return {
    returnCount: agg?._count._all ?? 0,
    refundedTotal: money(agg?._sum.totalAmount),
  };
}

export async function expenseSummary(range: { from: Date; to: Date }) {
  const byCategory = await prisma.expense.groupBy({
    by: ['categoryId'],
    where: { status: ExpenseStatus.ACTIVE, expenseDate: { gte: range.from, lt: range.to } },
    _sum: { amount: true },
  });
  const categories = await prisma.expenseCategory.findMany({
    where: { id: { in: byCategory.map((row) => row.categoryId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(categories.map((category) => [category.id, category.name]));

  const total = await prisma.expense.aggregate({
    where: { status: ExpenseStatus.ACTIVE, expenseDate: { gte: range.from, lt: range.to } },
    _sum: { amount: true },
  });

  return {
    total: money(total?._sum.amount),
    byCategory: byCategory
      .map((row) => ({ categoryId: row.categoryId, categoryName: nameById.get(row.categoryId) ?? 'Unknown', total: money(row._sum.amount) }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
  };
}

/**
 * Full financial picture for a range:
 *   Revenue - COGS = Gross Profit; Gross Profit - Operating Expenses =
 *   Net Operating Result. Expenses never mix into COGS.
 */
export async function financialReport(range: { from: Date; to: Date }) {
  const [sales, payments, returns, expenses] = await Promise.all([
    salesSummary(range),
    paymentMethodTotals(range),
    returnsSummary(range),
    expenseSummary(range),
  ]);

  const grossProfit = decimal(sales.grossProfit);
  const operatingExpenses = decimal(expenses.total);
  const netOperatingResult = grossProfit.sub(operatingExpenses);

  return {
    range: { from: range.from, to: range.to },
    sales,
    payments,
    returns,
    expenses,
    netOperatingResult: {
      grossProfit: money(grossProfit),
      operatingExpenses: money(operatingExpenses),
      netOperatingResult: money(netOperatingResult),
    },
  };
}
