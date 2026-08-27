// Stage 9 — expense service tests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import http from 'node:http';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const _ASSISTANT_ID = 'assistant-1';
const CATEGORY_ID = 'ecat-1';

interface CategoryRec {
  id: string;
  name: string;
  description: string | null;
  expenses?: { id: string }[];
}

interface ExpenseRec {
  id: string;
  categoryId: string;
  amount: unknown;
  expenseDate: Date;
  description: string | null;
  reference: string | null;
  paymentMethod: string | null;
  status: string;
  createdById: string;
  createdAt: Date;
  category?: { id: string; name: string };
  createdBy?: { id: string; fullName: string };
}

let categories: Record<string, CategoryRec> = {};
let expenses: ExpenseRec[] = [];
let expIdCounter = 1;
const auditRecords: Array<Record<string, unknown>> = [];

const db = {
  user: {
    findUnique: mock.fn(async (args: { where: { id?: string } }) => {
      if (args.where?.id === ADMIN_ID) return { id: ADMIN_ID, email: 'admin@test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      return null;
    }),
    update: mock.fn(async () => ({})),
  },
  expenseCategory: {
    findUnique: mock.fn(async (args: { where: { id?: string; name?: string } }) => {
      if (args.where.id) return categories[args.where.id] ?? null;
      return Object.values(categories).find((c) => c.name === args.where.name) ?? null;
    }),
    create: mock.fn(async (args: { data: Omit<CategoryRec, 'id' | 'expenses'> }) => {
      const id = `ecat-${Object.keys(categories).length + 1}`;
      const rec = { id, ...args.data };
      categories[id] = rec;
      return rec;
    }),
    update: mock.fn(async (args: { where: { id: string }; data: Partial<CategoryRec> }) => {
      const existing = categories[args.where.id];
      if (!existing) return null;
      const updated = { ...existing, ...args.data };
      categories[args.where.id] = updated;
      return updated;
    }),
    findMany: mock.fn(async () => Object.values(categories)),
  },
  expense: {
    findUnique: mock.fn(async (args: { where: { id: string } }) => {
      return expenses.find((e) => e.id === args.where.id) ?? null;
    }),
    create: mock.fn(async (args: { data: Omit<ExpenseRec, 'id' | 'createdAt' | 'category' | 'createdBy'> & { createdById: string } }) => {
      const id = `exp-${expIdCounter++}`;
      const rec: ExpenseRec = { id, ...args.data, createdAt: new Date() } as ExpenseRec;
      const cat = categories[args.data.categoryId];
      rec.category = cat ? { id: cat.id, name: cat.name } : undefined;
      expenses.push(rec);
      return rec;
    }),
    update: mock.fn(async (args: { where: { id: string }; data: Partial<ExpenseRec> }) => {
      const existing = expenses.find((e) => e.id === args.where.id);
      if (!existing) return null;
      Object.assign(existing, args.data);
      return existing;
    }),
    count: mock.fn(async () => expenses.length),
    findMany: mock.fn(async (args?: { skip?: number; take?: number }) => {
      return expenses.slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? 25));
    }),
    aggregate: mock.fn(async () => ({ _sum: { amount: expenses.reduce((sum, e) => sum + Number(e.amount), 0) } })),
    groupBy: mock.fn(async () => []),
  },
  auditLog: {
    create: mock.fn(async (args: { data: Record<string, unknown> }) => {
      auditRecords.push(args.data);
      return args.data;
    }),
  },
  $queryRaw: mock.fn(async () => []),
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

async function getCsrf(port: number, jar: CookieJar): Promise<string> {
  const res = await request(port, jar, 'GET', '/api/auth/csrf');
  assert.equal(res.status, 200);
  return (res.body as { csrfToken: string }).csrfToken;
}

function adminJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
  return jar;
}

beforeEach(() => {
  for (const fn of [
    db.user.findUnique, db.user.update,
    db.expenseCategory.findUnique, db.expenseCategory.create, db.expenseCategory.update, db.expenseCategory.findMany,
    db.expense.findUnique, db.expense.create, db.expense.update, db.expense.count, db.expense.findMany, db.expense.aggregate, db.expense.groupBy,
    db.auditLog.create,
  ]) {
    fn.mock.resetCalls();
  }
  categories = { [CATEGORY_ID]: { id: CATEGORY_ID, name: 'Utilities', description: 'Bills & utilities' } };
  expenses = [];
  expIdCounter = 1;
  auditRecords.length = 0;
});

afterEach(() => { mock.reset(); });

describe('expense categories', () => {
  test('createExpenseCategory creates a category and audits', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/finance/expense-categories', { name: 'Rent' }, csrf);
      assert.equal(res.status, 201);
      assert.equal((res.body as { category: CategoryRec }).category.name, 'Rent');
      assert.ok(auditRecords.some((a) => a.action === 'EXPENSE_CATEGORY_CREATED'));
    } finally { await close(); }
  });

  test('createExpenseCategory rejects duplicate name', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/finance/expense-categories', { name: 'Utilities' }, csrf);
      assert.equal(res.status, 409);
    } finally { await close(); }
  });

  test('updateExpenseCategory updates a category and audits', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PATCH', `/api/finance/expense-categories/${CATEGORY_ID}`, { name: 'Bills' }, csrf);
      assert.equal(res.status, 200);
      assert.equal((res.body as { category: CategoryRec }).category.name, 'Bills');
      assert.ok(auditRecords.some((a) => a.action === 'EXPENSE_CATEGORY_UPDATED'));
    } finally { await close(); }
  });

  test('listExpenseCategories returns all categories', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/expense-categories');
      assert.equal(res.status, 200);
      const body = res.body as { items: CategoryRec[] };
      assert.ok(body.items.length >= 1);
    } finally { await close(); }
  });
});

describe('expenses', () => {
  test('createExpense creates an expense and audits', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/finance/expenses', {
        categoryId: CATEGORY_ID, amount: 150000, description: 'Electricity bill',
      }, csrf);
      assert.equal(res.status, 201);
      const body = res.body as { expense: ExpenseRec };
      assert.equal(body.expense.categoryId, CATEGORY_ID);
      assert.equal(body.expense.description, 'Electricity bill');
      assert.ok(auditRecords.some((a) => a.action === 'EXPENSE_CREATED'));
    } finally { await close(); }
  });

  test('createExpense rejects non-existent category', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/finance/expenses', {
        categoryId: 'nonexistent', amount: 50000,
      }, csrf);
      assert.equal(res.status, 404);
    } finally { await close(); }
  });

  test('updateExpense updates an expense and audits', async () => {
    expenses.push({
      id: 'exp-1', categoryId: CATEGORY_ID, amount: 100000, expenseDate: new Date(),
      description: 'Old description', reference: null, paymentMethod: null,
      status: 'ACTIVE', createdById: ADMIN_ID, createdAt: new Date(),
      category: { id: CATEGORY_ID, name: 'Utilities' },
      createdBy: { id: ADMIN_ID, fullName: 'Admin' },
    });
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PATCH', '/api/finance/expenses/exp-1', { description: 'Updated' }, csrf);
      assert.equal(res.status, 200);
      assert.ok(auditRecords.some((a) => a.action === 'EXPENSE_UPDATED'));
    } finally { await close(); }
  });

  test('voidExpense voids an expense and audits', async () => {
    expenses.push({
      id: 'exp-2', categoryId: CATEGORY_ID, amount: 200000, expenseDate: new Date(),
      description: 'To be voided', reference: null, paymentMethod: null,
      status: 'ACTIVE', createdById: ADMIN_ID, createdAt: new Date(),
      category: { id: CATEGORY_ID, name: 'Utilities' },
      createdBy: { id: ADMIN_ID, fullName: 'Admin' },
    });
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/finance/expenses/exp-2/void', undefined, csrf);
      assert.equal(res.status, 200);
      assert.ok(auditRecords.some((a) => a.action === 'EXPENSE_VOIDED'));
    } finally { await close(); }
  });

  test('voidExpense rejects already voided expense', async () => {
    expenses.push({
      id: 'exp-3', categoryId: CATEGORY_ID, amount: 100000, expenseDate: new Date(),
      description: 'Already voided', reference: null, paymentMethod: null,
      status: 'VOIDED', createdById: ADMIN_ID, createdAt: new Date(),
      category: { id: CATEGORY_ID, name: 'Utilities' },
      createdBy: { id: ADMIN_ID, fullName: 'Admin' },
    });
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/finance/expenses/exp-3/void', undefined, csrf);
      assert.equal(res.status, 409);
    } finally { await close(); }
  });

  test('listExpenses returns paginated results', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', '/api/finance/expenses?pageSize=10');
      assert.equal(res.status, 200);
    } finally { await close(); }
  });
});
