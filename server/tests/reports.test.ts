// Stage 9 — reports service tests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import http from 'node:http';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';

let salesAgg: { _count: { _all: number }; _sum: { totalAmount: number; discount: number } };
let saleItemAgg: { _sum: { lineCost: number } };
let paymentGroupBy: Array<{ paymentMethod: string; _sum: { amount: number } }>;
let rawSales: Array<unknown>;
let creditAccounts: Array<Record<string, unknown>>;
let returnsAgg: { _count: { _all: number }; _sum: { totalAmount: number } };
let expenseAgg: { _sum: { amount: number } };
let expenseGroupBy: Array<{ categoryId: string; _sum: { amount: number } }>;
let expenseCategories: Array<{ id: string; name: string }>;

const db = {
  user: {
    findUnique: mock.fn(async (args: { where: { id?: string } }) => {
      if (args.where?.id === ADMIN_ID) return { id: ADMIN_ID, email: 'admin@test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      return null;
    }),
    update: mock.fn(async () => ({})),
  },
  sale: {
    aggregate: mock.fn(async () => salesAgg),
  },
  saleItem: {
    aggregate: mock.fn(async () => saleItemAgg),
  },
  payment: {
    groupBy: mock.fn(async () => paymentGroupBy),
  },
  $queryRaw: mock.fn(async () => rawSales),
  customerCreditAccount: {
    aggregate: mock.fn(async () => ({
      _count: { _all: creditAccounts.length },
      _sum: {
        outstandingBalance: creditAccounts.reduce((s, a) => s + Number(a.outstandingBalance), 0),
        creditLimit: creditAccounts.reduce((s, a) => s + Number(a.creditLimit), 0),
      },
    })),
    findMany: mock.fn(async () => creditAccounts),
  },
  saleReturn: {
    aggregate: mock.fn(async () => returnsAgg),
  },
  expense: {
    aggregate: mock.fn(async () => expenseAgg),
    groupBy: mock.fn(async () => expenseGroupBy),
  },
  expenseCategory: {
    findMany: mock.fn(async () => expenseCategories),
  },
  auditLog: {
    create: mock.fn(async () => ({})),
  },
  $queryRawUnsafe: mock.fn(async () => []),
  $transaction: mock.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};

(globalThis as unknown as { __MAKIRE_PRISMA__: unknown }).__MAKIRE_PRISMA__ = db;

const { createApp } = await import('../src/app.js');
const { signSessionToken } = await import('../src/utils/tokens.js');

class CookieJar {
  cookies = new Map<string, string>();
  setFrom(headers: Headers): void {
    const setCookies = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
    const raw = Array.isArray(setCookies) ? setCookies : [headers.get('set-cookie')].filter(Boolean) as string[];
    for (const sc of raw) {
      const pair = sc.split(';')[0];
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies.entries()].filter(([, v]) => v.length > 0).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = createApp();
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function request(
  port: number, jar: CookieJar, method: string, path: string, body?: unknown, csrfToken?: string,
): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const headers: Record<string, string> = {};
  const cookieHeader = jar.header();
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual',
  });
  jar.setFrom(res.headers);
  let json: Record<string, unknown> | null = null;
  try { json = (await res.json()) as Record<string, unknown>; } catch { json = null; }
  return { status: res.status, body: (json ?? {}) as Record<string, unknown>, headers: res.headers };
}

function adminJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
  return jar;
}

beforeEach(() => {
  for (const fn of [
    db.user.findUnique, db.user.update,
    db.sale.aggregate, db.saleItem.aggregate, db.payment.groupBy, db.$queryRaw,
    db.customerCreditAccount.aggregate, db.customerCreditAccount.findMany,
    db.saleReturn.aggregate, db.expense.aggregate, db.expense.groupBy, db.expenseCategory.findMany,
    db.auditLog.create, db.$transaction,
  ]) {
    fn.mock.resetCalls();
  }
  salesAgg = { _count: { _all: 0 }, _sum: { totalAmount: 0, discount: 0 } };
  saleItemAgg = { _sum: { lineCost: 0 } };
  paymentGroupBy = [];
  rawSales = [];
  creditAccounts = [];
  returnsAgg = { _count: { _all: 0 }, _sum: { totalAmount: 0 } };
  expenseAgg = { _sum: { amount: 0 } };
  expenseGroupBy = [];
  expenseCategories = [];
});

afterEach(() => { mock.reset(); });

describe('reports', () => {
  test('sales summary returns zeroed data when no sales exist', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/financial?preset=today');
      assert.equal(res.status, 200);
      const body = res.body as { sales: { saleCount: number; revenue: string; cogs: string; grossProfit: string } };
      assert.equal(body.sales.saleCount, 0);
      assert.equal(body.sales.revenue, '0.00');
      assert.equal(body.sales.cogs, '0.00');
      assert.equal(body.sales.grossProfit, '0.00');
    } finally { await close(); }
  });

  test('sales summary computes profit correctly', async () => {
    salesAgg = { _count: { _all: 10 }, _sum: { totalAmount: 5000000, discount: 100000 } };
    saleItemAgg = { _sum: { lineCost: 3000000 } };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/financial?preset=this_month');
      assert.equal(res.status, 200);
      const body = res.body as { sales: { saleCount: number; revenue: string; cogs: string; grossProfit: string; discounts: string } };
      assert.equal(body.sales.saleCount, 10);
      assert.equal(body.sales.revenue, '5000000.00');
      assert.equal(body.sales.cogs, '3000000.00');
      assert.equal(body.sales.grossProfit, '2000000.00');
      assert.equal(body.sales.discounts, '100000.00');
    } finally { await close(); }
  });

  test('payment method totals are returned', async () => {
    paymentGroupBy = [
      { paymentMethod: 'CASH', _sum: { amount: 3000000 } },
      { paymentMethod: 'MPESA', _sum: { amount: 2000000 } },
    ];
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/financial?preset=today');
      assert.equal(res.status, 200);
      const body = res.body as { payments: Array<{ paymentMethod: string; total: string }> };
      assert.equal(body.payments.length, 2);
      assert.equal(body.payments[0].paymentMethod, 'CASH');
      assert.equal(body.payments[0].total, '3000000.00');
    } finally { await close(); }
  });

  test('returns summary returns zeroed data when no returns', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/financial?preset=today');
      assert.equal(res.status, 200);
      const body = res.body as { returns: { returnCount: number; refundedTotal: string } };
      assert.equal(body.returns.returnCount, 0);
      assert.equal(body.returns.refundedTotal, '0.00');
    } finally { await close(); }
  });

  test('expense summary returns zeroed data when no expenses', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/financial?preset=today');
      assert.equal(res.status, 200);
      const body = res.body as { expenses: { total: string; byCategory: Array<unknown> } };
      assert.equal(body.expenses.total, '0.00');
      assert.equal(body.expenses.byCategory.length, 0);
    } finally { await close(); }
  });

  test('net operating result is computed correctly', async () => {
    salesAgg = { _count: { _all: 5 }, _sum: { totalAmount: 4000000, discount: 0 } };
    saleItemAgg = { _sum: { lineCost: 2500000 } };
    expenseAgg = { _sum: { amount: 500000 } };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/financial?preset=today');
      assert.equal(res.status, 200);
      const body = res.body as { netOperatingResult: { grossProfit: string; operatingExpenses: string; netOperatingResult: string } };
      assert.equal(body.netOperatingResult.grossProfit, '1500000.00');
      assert.equal(body.netOperatingResult.operatingExpenses, '500000.00');
      assert.equal(body.netOperatingResult.netOperatingResult, '1000000.00');
    } finally { await close(); }
  });

  test('credit summary returns top debtors', async () => {
    creditAccounts = [
      { id: 'cca-1', customerId: 'c1', outstandingBalance: 500000, creditLimit: 1000000, customer: { id: 'c1', name: 'Big Customer', phone: '+255700000000' } },
      { id: 'cca-2', customerId: 'c2', outstandingBalance: 200000, creditLimit: 500000, customer: { id: 'c2', name: 'Small Customer', phone: '+255700000001' } },
    ];
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/credit');
      assert.equal(res.status, 200);
      const body = res.body as { activeAccounts: number; totalOutstanding: string; topDebtors: Array<{ name: string; outstandingBalance: string }> };
      assert.equal(body.activeAccounts, 2);
      assert.equal(body.totalOutstanding, '700000.00');
      assert.equal(body.topDebtors.length, 2);
      assert.equal(body.topDebtors[0].name, 'Big Customer');
    } finally { await close(); }
  });

  test('unauthenticated user cannot access reports', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const res = await request(port, jar, 'GET', '/api/finance/reports/financial?preset=today');
      assert.equal(res.status, 401);
    } finally { await close(); }
  });
});
