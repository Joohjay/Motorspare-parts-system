import { Prisma, PurchaseOrderStatus } from '@prisma/client';

import prisma from '../lib/prisma.js';
import {
  creditSummary,
  expenseSummary,
  paymentMethodTotals,
  resolveRange,
  salesSummary,
} from './reportsService.js';
import { listInventory } from './inventoryService.js';

function decimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(String(value));
}

function money(value: Prisma.Decimal | string | number): number {
  return Number(decimal(value).toDecimalPlaces(2));
}

/**
 * Aggregated management dashboard (Stage 8). One request, role-aware:
 * ASSISTANT gets operational numbers only — no COGS, gross profit, net
 * profit or expenses — because financial summaries reuse the exact same
 * report functions as the reports module there is a single source of truth.
 */
export async function getDashboard(role: 'ADMIN' | 'ASSISTANT') {
  const isAdmin = role === 'ADMIN';
  const range = resolveRange({ preset: 'today' });

  const [sales, methods, credit, lowStock, outOfStock] = await Promise.all([
    salesSummary(range),
    paymentMethodTotals(range),
    creditSummary(),
    listInventory({ stockStatus: 'LOW_STOCK', sortBy: 'quantity', sortOrder: 'asc', pageSize: 8 }),
    listInventory({ stockStatus: 'OUT_OF_STOCK', sortBy: 'name', sortOrder: 'asc', pageSize: 8 }),
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const topProductsRange = { from: monthStart, to: range.to };

  const [recentSales, recentPurchases, pendingPurchaseOrders, topProductRows, supplierCreditAgg, expenseTotals] =
    await Promise.all([
      prisma.sale.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          saleNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          createdBy: { select: { fullName: true } },
          customer: { select: { name: true } },
        },
      }),
      prisma.purchase.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          purchaseNumber: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.purchaseOrder.aggregate({
        where: { status: { in: [PurchaseOrderStatus.PENDING, PurchaseOrderStatus.PARTIALLY_RECEIVED] } },
        _count: { _all: true },
      }),
      prisma.saleItem.groupBy({
        by: ['productId'],
        where: {
          sale: { status: 'COMPLETED', createdAt: { gte: topProductsRange.from, lt: topProductsRange.to } },
        },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      prisma.supplierCreditAccount.aggregate({
        where: { status: 'ACTIVE' },
        _count: { _all: true },
        _sum: { outstandingBalance: true },
      }),
      isAdmin ? expenseSummary(range) : Promise.resolve(null),
    ]);

  const productIds = topProductRows.map((row) => row.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, sku: true, name: true },
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));

  const dashboard = {
    generatedAt: new Date().toISOString(),
    todaySales: {
      saleCount: sales.saleCount,
      revenue: sales.revenue,
      discounts: sales.discounts,
      averageSaleValue:
        sales.saleCount > 0 ? Math.round((Number(sales.revenue) / sales.saleCount) * 100) / 100 : 0,
    },
    paymentBreakdownToday: methods,
    inventoryAlerts: {
      lowStockCount: lowStock.pagination.totalItems,
      outOfStockCount: outOfStock.pagination.totalItems,
      lowStockItems: lowStock.items.map((item: Record<string, unknown>) => ({
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        minimumStock: item.minimumStock,
      })),
    },
    creditSummary: {
      activeAccounts: credit.activeAccounts,
      totalOutstanding: credit.totalOutstanding,
      topDebtors: credit.topDebtors.slice(0, 5),
    },
    recentSales: recentSales.map((sale) => ({
      id: sale.id,
      saleNumber: sale.saleNumber,
      status: sale.status,
      totalAmount: money(sale.totalAmount),
      createdAt: sale.createdAt,
      cashierName: sale.createdBy.fullName,
      customerName: sale.customer?.name ?? null,
    })),
    recentPurchases: recentPurchases.map((purchase) => ({
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      status: purchase.status,
      totalAmount: money(purchase.totalAmount),
      createdAt: purchase.createdAt,
      supplierName: purchase.supplier.name,
    })),
    pendingPurchaseOrders: pendingPurchaseOrders?._count._all ?? 0,
    supplierCredit: {
      activeAccounts: supplierCreditAgg?._count._all ?? 0,
      totalOutstanding: money(supplierCreditAgg?._sum.outstandingBalance ?? 0),
    },
    topProductsThisMonth: topProductRows.map((row) => {
      const product = productById.get(row.productId);
      return {
        productId: row.productId,
        sku: product?.sku ?? '',
        name: product?.name ?? '',
        unitsSold: row._sum.quantity ?? 0,
        revenue: money(row._sum.lineTotal ?? 0),
      };
    }),
  };

  // Financial figures are ADMIN-only.
  if (!isAdmin) {
    return dashboard;
  }

  return {
    ...dashboard,
    todayFinancials: {
      cogs: sales.cogs,
      grossProfit: sales.grossProfit,
      expensesTotal: expenseTotals ? expenseTotals.total : 0,
      netProfit: (() => {
        const gross = decimal(sales.grossProfit);
        const expenses = decimal(expenseTotals ? expenseTotals.total : 0);
        return money(gross.sub(expenses));
      })(),
    },
  };
}
