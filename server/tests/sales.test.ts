// Stage 7 — sales/POS & expenses unit verification.
//
// Runs against the real Express app (createApp) with Prisma replaced by an
// in-memory mock via the lib/prisma test seam (globalThis.__MAKIRE_PRISMA__).
// Covers pricing/discount/payment-allocation rules, COGS freezing, void
// reversal and the ADMIN/ASSISTANT authorization boundary.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';

import http from 'node:http';

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const ASSISTANT_ID = 'assistant-1';

interface UserRec {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'ASSISTANT';
  status: 'ACTIVE' | 'INACTIVE';
  passwordHash: string;
  tokenVersion: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type Rec = Record<string, unknown>;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let usersById: Record<string, UserRec> = {};
let customers: Rec[] = [];
let products: Rec[] = [];
let inventories: Rec[] = [];
let inventoryTransactions: Rec[] = [];
let sales: Rec[] = [];
let saleItems: Rec[] = [];
let payments: Rec[] = [];
let saleReturns: Rec[] = [];
let saleReturnItems: Rec[] = [];
let creditAccounts: Rec[] = [];
let creditPayments: Rec[] = [];
let expenses: Rec[] = [];
let expenseCategories: Rec[] = [];
let notifications: Rec[] = [];
let documentSequences: Rec[] = [];
const auditRecords: unknown[] = [];

function makeUser(id: string, role: 'ADMIN' | 'ASSISTANT'): UserRec {
  return {
    id,
    email: `${id}@makire.test`,
    fullName: role === 'ADMIN' ? 'System Admin' : 'Shop Assistant',
    role,
    status: 'ACTIVE',
    passwordHash: '',
    tokenVersion: 0,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function seedFixtures(): void {
  usersById = {
    [ADMIN_ID]: makeUser(ADMIN_ID, 'ADMIN'),
    [ASSISTANT_ID]: makeUser(ASSISTANT_ID, 'ASSISTANT'),
  };
  customers = [
    { id: 'cust-1', name: 'John Mechanic', phone: '+255700000001', email: null, address: null, notes: null, type: 'MECHANIC', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'cust-inactive', name: 'Inactive Shop', phone: null, email: null, address: null, notes: null, type: 'RETAIL', status: 'INACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  products = [
    { id: 'prod-1', sku: 'P-1', name: 'Brake Pad', categoryId: 'cat-1', brandId: 'brand-1', retailPrice: 100, wholesalePrice: 80, minimumStock: 3, reorderLevel: 2, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'prod-2', sku: 'P-2', name: 'Chain', categoryId: 'cat-1', brandId: 'brand-1', retailPrice: 200, wholesalePrice: 150, minimumStock: 3, reorderLevel: 2, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'prod-off', sku: 'P-OFF', name: 'Discontinued', categoryId: 'cat-1', brandId: 'brand-1', retailPrice: 50, wholesalePrice: 40, minimumStock: 3, reorderLevel: 2, status: 'INACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  inventories = [
    { id: 'inv-1', productId: 'prod-1', quantityOnHand: 50, quantityReserved: 0, weightedAverageCost: 60, updatedAt: new Date() },
    { id: 'inv-2', productId: 'prod-2', quantityOnHand: 30, quantityReserved: 0, weightedAverageCost: 120, updatedAt: new Date() },
  ];
  inventoryTransactions = [];
  sales = [];
  saleItems = [];
  payments = [];
  saleReturns = [];
  saleReturnItems = [];
  creditAccounts = [
    { id: 'ccacc-1', customerId: 'cust-1', creditLimit: 100000, outstandingBalance: 20000, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  creditPayments = [];
  expenses = [];
  expenseCategories = [
    { id: 'expcat-1', name: 'Electricity', description: null, createdAt: new Date(), updatedAt: new Date() },
  ];
  notifications = [];
  documentSequences = [
    { documentType: 'SALE', prefix: 'SALE', lastNumber: 0, padLength: 6 },
    { documentType: 'SALE_RETURN', prefix: 'SALE_RETURN', lastNumber: 0, padLength: 6 },
  ];
  auditRecords.length = 0;
}

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function makeFindFirst(getRows: () => Rec[]) {
  return mock.fn((args: { where?: { [key: string]: unknown } }) => {
    const rows = getRows();
    const where = args.where ?? {};
    const entries = Object.entries(where);
    const found = rows.find((row) =>
      entries.every(([key, value]) => {
        if (value !== null && typeof value === 'object' && 'not' in (value as object)) {
          return row[key] !== (value as { not: unknown }).not;
        }
        return row[key] === value;
      }),
    );
    return Promise.resolve(found ?? null);
  });
}

function expenseWithRelations(rec: Rec): Rec {
  return {
    ...rec,
    category: expenseCategories.find((c) => c.id === rec.categoryId) ?? { id: '', name: '' },
    createdBy: usersById[String(rec.createdById)] ?? { id: '', fullName: '' },
  };
}

function saleWithRelations(rec: Rec): Rec {
  return {
    ...rec,
    items: saleItems
      .filter((item) => item.saleId === rec.id)
      .map((item) => ({ ...item, product: products.find((p) => p.id === item.productId) })),
    payments: payments.filter((p) => p.saleId === rec.id),
    returns: saleReturns.filter((r) => r.saleId === rec.id),
    customer: customers.find((c) => c.id === rec.customerId) ?? null,
    createdBy: usersById[String(rec.createdById)] ?? null,
  };
}

const db = {
  user: {
    findUnique: mock.fn((args: { where: { id?: string; email?: string } }) => {
      if (args.where.id) return Promise.resolve(usersById[args.where.id] ?? null);
      if (args.where.email) {
        return Promise.resolve(
          Object.values(usersById).find((u) => u.email === args.where.email) ?? null,
        );
      }
      return Promise.resolve(null);
    }),
    findMany: mock.fn(() => Promise.resolve(Object.values(usersById))),
  },
  customer: {
    findUnique: mock.fn((args: { where: { id: string } }) => {
      const rec = customers.find((c) => c.id === args.where.id);
      if (!rec) return Promise.resolve(null);
      return Promise.resolve({
        ...rec,
        creditAccount: creditAccounts.find((a) => a.customerId === rec.id) ?? null,
        _count: {
          sales: sales.filter((s2) => s2.customerId === rec.id).length,
          returns: saleReturns.filter((r) => r.customerId === rec.id).length,
        },
      });
    }),
    findFirst: makeFindFirst(() => customers),
    findMany: mock.fn((args?: { where?: { OR?: unknown[] } }) => {
      let rows = [...customers];
      const q = args?.where && 'OR' in args.where ? args.where.OR as Array<Record<string, { contains: string; mode: string }>> : null;
      if (q) {
        const needle = q[0]?.name?.contains.toLowerCase() ?? '';
        rows = rows.filter((c) => String(c.name).toLowerCase().includes(needle));
      }
      return Promise.resolve(rows);
    }),
    count: mock.fn(() => Promise.resolve(customers.length)),
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('cust'),
        status: 'ACTIVE',
        type: 'RETAIL',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      };
      customers.push(rec);
      return Promise.resolve(rec);
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const rec = customers.find((c) => c.id === args.where.id);
      if (!rec) return Promise.reject(new Error('customer not found'));
      Object.assign(rec, args.data);
      return Promise.resolve(rec);
    }),
  },
  product: {
    findUnique: mock.fn((args: { where: { id: string } }) =>
      Promise.resolve(products.find((p) => p.id === args.where.id) ?? null)),
    findMany: mock.fn((args?: { where?: { id?: { in: string[] } } }) => {
      const ids = args?.where?.id?.in;
      return Promise.resolve(ids ? products.filter((p) => ids.includes(String(p.id))) : products);
    }),
  },
  inventory: {
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const inv = inventories.find((i) => i.id === args.where.id);
      if (!inv) return Promise.reject(new Error('inventory not found'));
      Object.assign(inv, args.data);
      return Promise.resolve(inv);
    }),
  },
  inventoryTransaction: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('txn'), createdAt: new Date(), ...args.data };
      inventoryTransactions.push(rec);
      return Promise.resolve(rec);
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const txn = inventoryTransactions.find((t) => t.id === args.where.id);
      if (!txn) return Promise.reject(new Error('txn not found'));
      Object.assign(txn, args.data);
      return Promise.resolve(txn);
    }),
  },
  sale: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('sale'), status: 'COMPLETED', createdAt: new Date(), updatedAt: new Date(), ...args.data };
      sales.push(rec);
      return Promise.resolve(rec);
    }),
    findUnique: mock.fn((args: { where: { id?: string; saleNumber?: string } }) => {
      const rec = args.where.id
        ? sales.find((s) => s.id === args.where.id)
        : sales.find((s) => s.saleNumber === args.where.saleNumber);
      return Promise.resolve(rec ? saleWithRelations(rec) : null);
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const rec = sales.find((s) => s.id === args.where.id);
      if (!rec) return Promise.reject(new Error('sale not found'));
      Object.assign(rec, args.data);
      return Promise.resolve(saleWithRelations(rec));
    }),
    count: mock.fn(() => Promise.resolve(sales.length)),
    findMany: mock.fn(() => Promise.resolve(sales.map(saleWithRelations))),
  },
  saleItem: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('sitem'), ...args.data };
      saleItems.push(rec);
      return Promise.resolve(rec);
    }),
    groupBy: mock.fn((args: { by: string[]; where: { saleItemId: { in: string[] }; saleReturn: { status: string } }; _sum: { quantityReturned: boolean } }) => {
      const ids = args.where.saleItemId.in;
      const completedIds = new Set(saleReturns.filter((r) => r.status === 'COMPLETED').map((r) => r.id));
      const rows = saleReturnItems.filter(
        (ri) => ids.includes(String(ri.saleItemId)) && completedIds.has(String(ri.saleReturnId)),
      );
      const grouped = new Map<string, number>();
      for (const row of rows) {
        grouped.set(String(row.saleItemId), (grouped.get(String(row.saleItemId)) ?? 0) + Number(row.quantityReturned));
      }
      return Promise.resolve([...grouped.entries()].map(([saleItemId, qty]) => ({ saleItemId, _sum: { quantityReturned: qty } })));
    }),
  },
  payment: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('pay'), paidAt: new Date(), createdAt: new Date(), ...args.data };
      payments.push(rec);
      return Promise.resolve(rec);
    }),
    findMany: mock.fn(() =>
      Promise.resolve(payments.map((p) => ({ ...p, sale: sales.find((s2) => s2.id === p.saleId) ?? null })))),
    groupBy: mock.fn(() => Promise.resolve([])),
  },
  saleReturn: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('ret'), status: 'COMPLETED', returnDate: new Date(), createdAt: new Date(), updatedAt: new Date(), ...args.data };
      saleReturns.push(rec);
      return Promise.resolve(rec);
    }),
    findUnique: mock.fn((args: { where: { id: string } }) => {
      const rec = saleReturns.find((r) => r.id === args.where.id);
      if (!rec) return Promise.resolve(null);
      return Promise.resolve({
        ...rec,
        items: saleReturnItems.filter((ri) => ri.saleReturnId === rec.id),
        sale: sales.find((s) => s.id === rec.saleId) ?? null,
        customer: customers.find((c) => c.id === rec.customerId) ?? null,
        createdBy: usersById[String(rec.createdById)] ?? null,
      });
    }),
    findMany: mock.fn(() => Promise.resolve(saleReturns)),
    count: mock.fn(() => Promise.resolve(saleReturns.length)),
  },
  saleReturnItem: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('ritem'), ...args.data };
      saleReturnItems.push(rec);
      return Promise.resolve(rec);
    }),
    groupBy: mock.fn((args: { where: { saleItemId: { in: string[] } } }) => {
      const ids = args.where.saleItemId.in;
      const completedIds = new Set(saleReturns.filter((r) => r.status === 'COMPLETED').map((r) => r.id));
      const rows = saleReturnItems.filter(
        (ri) => ids.includes(String(ri.saleItemId)) && completedIds.has(String(ri.saleReturnId)),
      );
      const grouped = new Map<string, number>();
      for (const row of rows) {
        grouped.set(String(row.saleItemId), (grouped.get(String(row.saleItemId)) ?? 0) + Number(row.quantityReturned));
      }
      return Promise.resolve([...grouped.entries()].map(([saleItemId, qty]) => ({ saleItemId, _sum: { quantityReturned: qty } })));
    }),
  },
  customerCreditAccount: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('ccacc'), status: 'ACTIVE', creditLimit: 0, outstandingBalance: 0, createdAt: new Date(), updatedAt: new Date(), ...args.data };
      creditAccounts.push(rec);
      return Promise.resolve(rec);
    }),
    findUnique: makeFindFirst(() => creditAccounts),
    findUniqueOrThrow: mock.fn((args: { where: { id?: string; customerId?: string } }) => {
      const rec = args.where.customerId
        ? creditAccounts.find((a) => a.customerId === args.where.customerId)
        : creditAccounts.find((a) => a.id === args.where.id);
      return rec ? Promise.resolve(rec) : Promise.reject(new Error('credit account not found'));
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const rec = creditAccounts.find((a) => a.id === args.where.id);
      if (!rec) return Promise.reject(new Error('account not found'));
      Object.assign(rec, args.data);
      return Promise.resolve(rec);
    }),
    aggregate: mock.fn(() => Promise.resolve({ _count: { _all: 0 }, _sum: { outstandingBalance: null, creditLimit: null } })),
    findMany: mock.fn(() => Promise.resolve([])),
  },
  customerCreditPayment: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('ccpay'), paidAt: new Date(), createdAt: new Date(), ...args.data };
      creditPayments.push(rec);
      return Promise.resolve(rec);
    }),
    findMany: mock.fn(() => Promise.resolve(creditPayments)),
    count: mock.fn(() => Promise.resolve(creditPayments.length)),
  },
  expenseCategory: {
    findUnique: makeFindFirst(() => expenseCategories),
    findMany: mock.fn(() => Promise.resolve(expenseCategories)),
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('expcat'), createdAt: new Date(), updatedAt: new Date(), ...args.data };
      expenseCategories.push(rec);
      return Promise.resolve(rec);
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const rec = expenseCategories.find((c) => c.id === args.where.id);
      if (!rec) return Promise.reject(new Error('category not found'));
      Object.assign(rec, args.data);
      return Promise.resolve(rec);
    }),
  },
  expense: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('exp'), status: 'ACTIVE', expenseDate: new Date(), createdAt: new Date(), updatedAt: new Date(), ...args.data };
      expenses.push(rec);
      return Promise.resolve(expenseWithRelations(rec));
    }),
    findUnique: makeFindFirst(() => expenses),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const rec = expenses.find((e) => e.id === args.where.id);
      if (!rec) return Promise.reject(new Error('expense not found'));
      Object.assign(rec, args.data);
      return Promise.resolve(expenseWithRelations(rec));
    }),
    count: mock.fn(() => Promise.resolve(expenses.length)),
    findMany: mock.fn(() => Promise.resolve(expenses)),
  },
  notification: {
    findFirst: makeFindFirst(() => notifications),
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('notif'), createdAt: new Date(), ...args.data };
      notifications.push(rec);
      return Promise.resolve(rec);
    }),
  },
  auditLog: {
    create: mock.fn((args: { data: Record<string, unknown> }) => {
      auditRecords.push(args.data);
      return Promise.resolve(args.data);
    }),
  },
  // Snapshot-based transaction emulation: mutations made inside a failed
  // transaction are rolled back, mirroring PostgreSQL atomicity.
  $transaction: mock.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      const tables = [
        customers, products, inventories, inventoryTransactions, sales, saleItems,
        payments, saleReturns, saleReturnItems, creditAccounts, creditPayments,
        expenses, expenseCategories, notifications, documentSequences,
      ];
      const snapshot = tables.map((table) => table.map((row) => ({ ...row })));
      const rollback = () => {
        tables.forEach((table, index) => {
          table.length = 0;
          table.push(...(snapshot[index] ?? []));
        });
      };
      try {
        const result = (arg as (tx: unknown) => unknown)(db);
        if (result instanceof Promise) {
          return result.catch((err: unknown) => {
            rollback();
            throw err;
          });
        }
        return result;
      } catch (err) {
        rollback();
        throw err;
      }
    }
    if (Array.isArray(arg)) return Promise.all(arg);
    return Promise.reject(new Error('unsupported $transaction mode'));
  }),
  $queryRaw: mock.fn((query: unknown, ...rest: unknown[]) => {
    const q = (query as { strings?: string[]; values?: unknown[] }) ?? {};
    const sql = (q.strings ?? []).join(' ? ');
    const values = q.values ?? rest;

    if (sql.includes('document_sequences')) {
      const docType = String(values[0] ?? '');
      const seq = documentSequences.find((s) => s.documentType === docType);
      if (!seq) return Promise.resolve([]);
      seq.lastNumber = Number(seq.lastNumber) + 1;
      return Promise.resolve([
        { prefix: seq.prefix, lastNumber: seq.lastNumber, padLength: seq.padLength },
      ]);
    }

    if (sql.includes('customer_credit_accounts')) {
      const customerId = String(values[0] ?? '');
      const account = creditAccounts.find((a) => a.customerId === customerId);
      if (!account) return Promise.resolve([]);
      return Promise.resolve([{ id: account.id, outstandingBalance: account.outstandingBalance }]);
    }

    // Inventory lock: INSERT .. ON CONFLICT then SELECT .. FOR UPDATE.
    if (sql.includes('inventories')) {
      const productId = String(values[0] ?? '');
      let inv = inventories.find((i) => i.productId === productId);
      if (sql.includes('ON CONFLICT')) {
        if (inv) return Promise.resolve([]);
        inv = {
          id: nextId('inv'),
          productId,
          quantityOnHand: 0,
          quantityReserved: 0,
          weightedAverageCost: 0,
          updatedAt: new Date(),
        };
        inventories.push(inv);
        return Promise.resolve([inv]);
      }
      if (!inv) return Promise.resolve([]);
      return Promise.resolve([inv]);
    }

    return Promise.resolve([]);
  }),
};

(globalThis as unknown as { __MAKIRE_PRISMA__: unknown }).__MAKIRE_PRISMA__ = db;

const { createApp } = await import('../src/app.js');
const { signSessionToken } = await import('../src/utils/tokens.js');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

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
    return [...this.cookies.entries()]
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

let server: { port: number; close: () => Promise<void> } | null = null;

async function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = createApp();
  const s = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const address = s.address() as AddressInfo;
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        s.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

interface ApiResponseBody {
  csrfToken?: string;
  error?: { code: string; message: string };
  [key: string]: unknown;
}

async function request(
  port: number,
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
  csrfToken?: string,
): Promise<{ status: number; body: ApiResponseBody }> {
  const headers: Record<string, string> = {};
  const cookieHeader = jar.header();
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });

  jar.setFrom(res.headers);
  let json: ApiResponseBody | null = null;
  try {
    json = (await res.json()) as ApiResponseBody;
  } catch {
    json = null;
  }
  return { status: res.status, body: (json ?? {}) as ApiResponseBody };
}

async function getCsrf(port: number, jar: CookieJar): Promise<string> {
  const res = await request(port, jar, 'GET', '/api/auth/csrf');
  assert.equal(res.status, 200);
  return res.body.csrfToken as string;
}

function adminJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ADMIN_ID, 0));
  return jar;
}

function assistantJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ASSISTANT_ID, 0));
  return jar;
}

async function mutate(port: number, jar: CookieJar, method: string, path: string, body?: unknown) {
  const csrf = await getCsrf(port, jar);
  return request(port, jar, method, path, body, csrf);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  seedFixtures();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('sales — POS creation', () => {
  test('cash sale computes totals, freezes COGS and deducts stock', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 2 }],
      payments: [{ paymentMethod: 'CASH', amount: 200 }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const sale = res.body.sale as Rec;

    assert.equal(sale.saleNumber, 'SALE-000001');
    assert.equal(sale.subtotal, '200.00');
    assert.equal(sale.totalAmount, '200.00');
    assert.equal(sale.cogs, '120.00'); // 2 x frozen cost 60
    assert.equal(sale.grossProfit, '80.00');

    const inv = inventories.find((i) => i.productId === 'prod-1');
    assert.equal(inv?.quantityOnHand, 48);

    const txn = inventoryTransactions.find((t) => t.referenceId !== null && t.type === 'SALE');
    assert.ok(txn, 'ledger entry linked to sale item');
    assert.equal(String(txn?.unitCost), '60');
  });

  test('wholesale sale uses the wholesale price', async () => {
    server = await startServer();
    const res = await mutate(server.port, assistantJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-2', quantity: 1 }],
      saleType: 'WHOLESALE',
      payments: [{ paymentMethod: 'CASH', amount: 150 }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((res.body.sale as Rec).totalAmount, '150.00');
  });

  test('line discount reduces the line total but cannot go negative', async () => {
    server = await startServer();
    const ok = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 2, discount: 20 }],
      payments: [{ paymentMethod: 'CASH', amount: 180 }],
    });
    assert.equal(ok.status, 201);
    assert.equal(((ok.body.sale as Rec).items as Rec[])[0]!.lineTotal, '180.00');

    const bad = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 2, discount: 500 }],
      payments: [{ paymentMethod: 'CASH', amount: -300 }],
    });
    assert.equal(bad.status, 400);
  });

  test('payment allocations must equal the sale total exactly', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 1 }],
      payments: [{ paymentMethod: 'CASH', amount: 90 }],
    });
    assert.equal(res.status, 400);
    assert.equal((res.body.error as Rec).code, 'PAYMENT_MISMATCH');
  });

  test('mixed payment splits across methods', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-2', quantity: 1 }],
      payments: [
        { paymentMethod: 'CASH', amount: 100 },
        { paymentMethod: 'MPESA', amount: 100 },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal((((res.body.sale as Rec).payments) as Rec[]).length, 2);
  });

  test('price override requires ADMIN', async () => {
    server = await startServer();

    const denied = await mutate(server.port, assistantJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 70 }],
      payments: [{ paymentMethod: 'CASH', amount: 70 }],
    });
    assert.equal(denied.status, 403);
    assert.equal((denied.body.error as Rec).code, 'PRICE_OVERRIDE_FORBIDDEN');

    const allowed = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 1, unitPrice: 70 }],
      payments: [{ paymentMethod: 'CASH', amount: 70 }],
    });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
    assert.equal(((allowed.body.sale as Rec).items as Rec[])[0]!.unitPrice, '70.00');
  });

  test('inactive product cannot be sold', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-off', quantity: 1 }],
      payments: [{ paymentMethod: 'CASH', amount: 50 }],
    });
    assert.equal(res.status, 409);
    assert.equal((res.body.error as Rec).code, 'PRODUCT_INACTIVE');
  });

  test('insufficient stock rolls back the whole sale', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-2', quantity: 999 }],
      payments: [{ paymentMethod: 'CASH', amount: 199800 }],
    });
    assert.equal(res.status, 409);
    assert.equal((res.body.error as Rec).code, 'INSUFFICIENT_STOCK');
    assert.equal(sales.length, 0, 'no sale persisted');
    assert.equal(inventories.find((i) => i.productId === 'prod-2')?.quantityOnHand, 30, 'stock untouched');
  });
});

describe('sale voiding', () => {
  test('void restores stock and marks the sale VOID', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 5 }],
      payments: [{ paymentMethod: 'CASH', amount: 500 }],
    });
    assert.equal(res.status, 201);
    const sale = res.body.sale as Rec;

    const voidRes = await mutate(server.port, adminJar(), 'POST', `/api/sales/${sale.id}/void`, {
      reason: 'Entered wrong quantity',
    });
    assert.equal(voidRes.status, 200, JSON.stringify(voidRes.body));

    assert.equal(inventories.find((i) => i.productId === 'prod-1')?.quantityOnHand, 50);

    const detail = await request(server.port, adminJar(), 'GET', `/api/sales/${sale.id}`);
    assert.equal((detail.body.sale as Rec).status, 'VOID');
  });

  test('voiding twice is rejected', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 1 }],
      payments: [{ paymentMethod: 'CASH', amount: 100 }],
    });
    const sale = res.body.sale as Rec;

    await mutate(server.port, adminJar(), 'POST', `/api/sales/${sale.id}/void`, { reason: 'first' });
    const second = await mutate(server.port, adminJar(), 'POST', `/api/sales/${sale.id}/void`, { reason: 'second' });
    assert.equal(second.status, 409);
  });

  test('ASSISTANT cannot void sales', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 1 }],
      payments: [{ paymentMethod: 'CASH', amount: 100 }],
    });
    const sale = res.body.sale as Rec;

    const denied = await mutate(server.port, assistantJar(), 'POST', `/api/sales/${sale.id}/void`, {
      reason: 'not allowed',
    });
    assert.equal(denied.status, 403);
  });
});

describe('expenses', () => {
  test('ADMIN creates an expense; ASSISTANT cannot', async () => {
    server = await startServer();

    const denied = await mutate(server.port, assistantJar(), 'POST', '/api/finance/expenses', {
      categoryId: 'expcat-1',
      amount: 5000,
    });
    assert.equal(denied.status, 403);

    const ok = await mutate(server.port, adminJar(), 'POST', '/api/finance/expenses', {
      categoryId: 'expcat-1',
      amount: 5000,
      description: 'February electricity',
      paymentMethod: 'CASH',
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((ok.body.expense as Rec).amount, '5000.00');
  });

  test('negative or zero amounts are rejected by validation', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/finance/expenses', {
      categoryId: 'expcat-1',
      amount: -5,
    });
    assert.equal(res.status, 400);
  });

  test('voided expenses stay in history but can be voided only once', async () => {
    server = await startServer();
    const created = await mutate(server.port, adminJar(), 'POST', '/api/finance/expenses', {
      categoryId: 'expcat-1',
      amount: 12000,
    });
    const expense = created.body.expense as Rec;

    const voided = await mutate(server.port, adminJar(), 'POST', `/api/finance/expenses/${expense.id}/void`);
    assert.equal(voided.status, 200);
    assert.equal((voided.body.expense as Rec).status, 'VOIDED');

    const again = await mutate(server.port, adminJar(), 'POST', `/api/finance/expenses/${expense.id}/void`);
    assert.equal(again.status, 409);
  });
});

describe('customers & authorization', () => {
  test('ASSISTANT cannot see COGS/profit on sale details', async () => {
    server = await startServer();
    const created = await mutate(server.port, adminJar(), 'POST', '/api/sales', {
      items: [{ productId: 'prod-1', quantity: 1 }],
      payments: [{ paymentMethod: 'CASH', amount: 100 }],
    });
    const sale = created.body.sale as Rec;

    const adminView = await request(server.port, adminJar(), 'GET', `/api/sales/${sale.id}`);
    assert.ok('cogs' in (adminView.body.sale as Rec));

    const assistantView = await request(server.port, assistantJar(), 'GET', `/api/sales/${sale.id}`);
    const seen = assistantView.body.sale as Rec;
    assert.ok(!('cogs' in seen));
    assert.ok(!('grossProfit' in seen));
    assert.ok(!('unitCost' in ((seen.items as Rec[])[0]!)));
  });
});
