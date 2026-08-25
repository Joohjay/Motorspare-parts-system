// Stage 6 — suppliers, purchasing, purchase orders & receiving, supplier credit.
//
// Runs against the real Express app (createApp) with Prisma replaced by an
// in-memory mock via the lib/prisma test seam (globalThis.__MAKIRE_PRISMA__).
// Covers business rules (ordered ≠ received ≠ accepted ≠ stock, over-receiving
// rejection, document numbering, credit overpayment rejection) and the
// ADMIN/ASSISTANT authorization boundary. Live PostgreSQL concurrency
// guarantees are verified in tests/integration/purchasing.integration.test.ts.

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
let categories: Rec[] = [];
let brands: Rec[] = [];
let products: Rec[] = [];
let suppliers: Rec[] = [];
let supplierProducts: Rec[] = [];
let purchaseOrders: Rec[] = [];
let purchaseOrderItems: Rec[] = [];
let purchases: Rec[] = [];
let purchaseItems: Rec[] = [];
let purchaseReturns: Rec[] = [];
let creditAccounts: Rec[] = [];
let creditPayments: Rec[] = [];
let inventories: Rec[] = [];
let inventoryTransactions: Rec[] = [];
let notifications: Rec[] = [];
let documentSequences: Rec[] = [];
const auditRecords: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// In-memory Prisma mock
// ---------------------------------------------------------------------------

type Where = Rec | Rec[] | null | undefined;

function fieldFilterMatch(fieldValue: unknown, filter: Rec): boolean {
  for (const [op, expected] of Object.entries(filter)) {
    switch (op) {
      case 'equals':
        if (expected === null || expected === undefined) {
          if (fieldValue !== null && fieldValue !== undefined) return false;
        } else if (fieldValue !== expected) {
          return false;
        }
        break;
      case 'not':
        if (expected === null) {
          if (fieldValue === null || fieldValue === undefined) return true;
        } else if (fieldValue === expected) {
          return false;
        }
        break;
      case 'contains':
        if (
          typeof fieldValue !== 'string' ||
          !fieldValue.toLowerCase().includes(String(expected).toLowerCase())
        ) {
          return false;
        }
        break;
      case 'startsWith':
        if (
          typeof fieldValue !== 'string' ||
          !fieldValue.toLowerCase().startsWith(String(expected).toLowerCase())
        ) {
          return false;
        }
        break;
      case 'in': {
        const list = Array.isArray(expected) ? expected : [];
        if (!list.some((item) => item === fieldValue)) return false;
        break;
      }
      case 'gt':
        if (!(Number(fieldValue) > Number(expected))) return false;
        break;
      case 'gte':
        if (!(Number(fieldValue) >= Number(expected))) return false;
        break;
      case 'lt':
        if (!(Number(fieldValue) < Number(expected))) return false;
        break;
      case 'lte':
        if (!(Number(fieldValue) <= Number(expected))) return false;
        break;
      case 'mode':
        break;
      default:
        break;
    }
  }
  return true;
}

function related(rec: Rec, key: string): Rec | Rec[] | null {
  const id = rec.id as string;
  switch (key) {
    case 'creditAccount':
      return creditAccounts.find((a) => a.supplierId === id) ?? null;
    case 'products':
      return supplierProducts.filter((p) => p.supplierId === id);
    case 'purchaseOrders':
      return purchaseOrders.filter((o) => o.supplierId === id);
    case 'purchases':
      return purchases.filter((p) => p.supplierId === id);
    case 'supplier':
      return suppliers.find((s) => s.id === rec.supplierId) ?? null;
    case 'createdBy':
      return (usersById[rec.createdById as string] ?? null) as unknown as Rec | null;
    case 'items':
      // 'items' is ambiguous: PurchaseOrder.items are PO lines,
      // Purchase.items are received purchase items.
      if (purchaseOrders.includes(rec)) {
        return purchaseOrderItems.filter((i) => i.purchaseOrderId === id);
      }
      return purchaseItems.filter((pi) => pi.purchaseId === id);
    case 'product':
      return products.find((p) => p.id === rec.productId) ?? null;
    case 'purchaseItems':
      return purchaseItems.filter((pi) => pi.purchaseOrderItemId === id);
    case 'purchaseOrderItem':
      return purchaseOrderItems.find((i) => i.id === rec.purchaseOrderItemId) ?? null;
    case 'purchaseOrder':
      return purchaseOrders.find((o) => o.id === rec.purchaseOrderId) ?? null;
    case 'returns':
      return purchaseReturns.filter((r) => r.purchaseId === id);
    case 'creditPayments':
      return creditPayments.filter((p) => p.purchaseId === id);
    case 'payments':
      return creditPayments.filter((p) => p.accountId === id);
    case 'purchase':
      return purchases.find((p) => p.id === rec.purchaseId) ?? null;
    case 'inventory':
      return inventories.find((i) => i.productId === id) ?? null;
    default:
      return [];
  }
}

function matchWhere(where: Where, rec: Rec, rel: (r: Rec, k: string) => Rec | Rec[] | null): boolean {
  if (!where) return true;
  if (Array.isArray(where)) return where.every((w) => matchWhere(w, rec, rel));
  const keys = Object.keys(where);
  if (keys.length === 0) return true;

  if ('AND' in where) {
    const list = Array.isArray(where.AND) ? (where.AND as Rec[]) : ([where.AND] as Rec[]);
    if (!list.every((w) => matchWhere(w, rec, rel))) return false;
  }
  if ('OR' in where) {
    const list = Array.isArray(where.OR) ? (where.OR as Rec[]) : ([where.OR] as Rec[]);
    if (!list.some((w) => matchWhere(w, rec, rel))) return false;
  }
  if ('NOT' in where) {
    const list = Array.isArray(where.NOT) ? (where.NOT as Rec[]) : ([where.NOT] as Rec[]);
    if (list.some((w) => matchWhere(w, rec, rel))) return false;
  }

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') continue;
    if (value === null || value === undefined) {
      if (rec[key] !== null && rec[key] !== undefined) return false;
      continue;
    }
    if (typeof value !== 'object') {
      if (rec[key] !== value) return false;
      continue;
    }
    const v = value as Rec;
    if ('some' in v) {
      const children = Array.isArray(rel(rec, key)) ? (rel(rec, key) as Rec[]) : [];
      if (!children.some((child) => matchWhere(v.some as Where, child, rel))) return false;
      continue;
    }
    if ('every' in v) {
      const children = Array.isArray(rel(rec, key)) ? (rel(rec, key) as Rec[]) : [];
      if (!children.every((child) => matchWhere(v.every as Where, child, rel))) return false;
      continue;
    }
    if ('is' in v) {
      const child = rel(rec, key);
      if (!child || Array.isArray(child)) return false;
      if (!matchWhere(v.is as Where, child, rel)) return false;
      continue;
    }
    if ('path' in v && Array.isArray(v.path)) {
      let nested: unknown = rec[key];
      for (const k of v.path as string[]) {
        if (nested && typeof nested === 'object') nested = (nested as Rec)[k];
        else {
          nested = undefined;
          break;
        }
      }
      const eq = v.equals;
      if (eq === null || eq === undefined) {
        if (nested !== null && nested !== undefined) return false;
      } else if (nested !== eq) {
        return false;
      }
      continue;
    }
    const operatorKeys = Object.keys(v).filter((k) =>
      ['some', 'every', 'is', 'none', 'contains', 'equals', 'in', 'startsWith', 'endsWith', 'gt', 'gte', 'lt', 'lte', 'mode', 'not'].includes(k),
    );
    if (operatorKeys.length === 0) {
      const child = rel(rec, key);
      if (child && !Array.isArray(child)) {
        if (!matchWhere(value as Where, child, rel)) return false;
        continue;
      }
    }
    if (!fieldFilterMatch(rec[key], v)) return false;
  }
  return true;
}

function pickFields(rec: Rec, select: Rec): Rec {
  const out: Rec = {};
  for (const key of Object.keys(select)) {
    if (key in rec) out[key] = rec[key];
  }
  return out;
}

function attachIncludes(rec: Rec, include: Rec | undefined): Rec {
  if (!include) return { ...rec };
  if (include.select) return pickFields(rec, include.select as Rec);
  if (include.include) return attachIncludes(rec, include.include as Rec);

  const out: Rec = { ...rec };
  for (const [rel, spec] of Object.entries(include)) {
    const specObj = (spec ?? {}) as Rec;
    if (rel === '_count') {
      const sel = (specObj.select ?? {}) as Rec;
      const counts: Rec = {};
      for (const [countKey, enabled] of Object.entries(sel)) {
        if (!enabled) continue;
        const children = related(rec, countKey);
        counts[countKey] = Array.isArray(children) ? children.length : children ? 1 : 0;
      }
      out._count = counts;
      continue;
    }
    const children = related(rec, rel);
    if (Array.isArray(children)) {
      out[rel] = children.map((child) => attachIncludes(child, specObj));
    } else if (children) {
      out[rel] = attachIncludes(children, specObj);
    } else {
      out[rel] = null;
    }
  }
  return out;
}

function sortRecords(rows: Rec[], orderBy: unknown): Rec[] {
  if (orderBy == null) return [...rows];
  const clauses = Array.isArray(orderBy) ? (orderBy as Rec[]) : [orderBy as Rec];
  const sorted = [...rows];
  for (const clause of clauses) {
    const [field, direction] = Object.entries(clause)[0] as [string, string];
    sorted.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av > bv ? 1 : -1;
      return direction === 'desc' ? -cmp : cmp;
    });
  }
  return sorted;
}

function makeFindMany(getRows: () => Rec[]) {
  return mock.fn((args: { where?: Where; orderBy?: unknown; skip?: number; take?: number; include?: Rec } = {}) => {
    const rows = getRows().filter((row) => matchWhere(args?.where, row, related));
    const ordered = sortRecords(rows, args?.orderBy);
    const skip = args?.skip ?? 0;
    const take = args?.take ?? ordered.length;
    return Promise.resolve(ordered.slice(skip, skip + take).map((row) => attachIncludes(row, args?.include)));
  });
}

function makeCount(getRows: () => Rec[]) {
  return mock.fn((args: { where?: Where } = {}) =>
    Promise.resolve(getRows().filter((row) => matchWhere(args?.where, row, related)).length),
  );
}

function makeFindFirst(getRows: () => Rec[]) {
  return mock.fn((args: { where?: Where; include?: Rec } = {}) => {
    const row = getRows().find((r) => matchWhere(args?.where, r, related));
    return Promise.resolve(row ? attachIncludes(row, args?.include) : null);
  });
}

function findById(getRows: () => Rec[]) {
  return mock.fn((args: { where?: Rec; include?: Rec } = {}) => {
    const where = args?.where ?? {};
    let row: Rec | undefined;
    if (typeof where.id === 'string') row = getRows().find((r) => r.id === where.id);
    else if (typeof where.sku === 'string') row = getRows().find((r) => r.sku === where.sku);
    return Promise.resolve(row ? attachIncludes(row, args?.include) : null);
  });
}

function makeUpdate(getRows: () => Rec[]) {
  return mock.fn((args: { where: { id: string }; data: Rec }) => {
    const row = getRows().find((r) => r.id === args.where.id);
    if (!row) return Promise.resolve(null);
    const merged: Rec = { ...row, ...args.data, updatedAt: new Date('2026-02-01T00:00:00Z') };
    Object.assign(row, merged);
    return Promise.resolve(merged);
  });
}

let txQueue: Promise<unknown> = Promise.resolve();
function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = txQueue.then(fn);
  txQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const db = {
  user: {
    findUnique: mock.fn((args: { where: { id?: string; email?: string } }) => {
      const where = args?.where ?? {};
      const user = where.id
        ? usersById[where.id]
        : Object.values(usersById).find((u) => u.email === where.email);
      return Promise.resolve(user ?? null);
    }),
    findMany: mock.fn((args: { where?: Rec } = {}) => {
      const users = Object.values(usersById).filter((u) => matchWhere(args?.where, u as unknown as Rec, related));
      return Promise.resolve(users);
    }),
  },
  category: { findUnique: findById(() => categories) },
  brand: { findUnique: findById(() => brands) },
  product: {
    findUnique: findById(() => products),
    findMany: makeFindMany(() => products),
    count: makeCount(() => products),
  },
  supplier: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('sup'),
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      suppliers.push(rec);
      return Promise.resolve(rec);
    }),
    update: makeUpdate(() => suppliers),
    findUnique: mock.fn((args: { where?: Rec; include?: Rec } = {}) => {
      const row = suppliers.find((r) => r.id === args.where?.id);
      return Promise.resolve(row ? attachIncludes(row, args.include) : null);
    }),
    findMany: makeFindMany(() => suppliers),
    count: makeCount(() => suppliers),
  },
  supplierProduct: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('sp'),
        status: 'ACTIVE',
        isPreferred: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      supplierProducts.push(rec);
      return Promise.resolve(rec);
    }),
    update: makeUpdate(() => supplierProducts),
    delete: mock.fn((args: { where: { id: string } }) => {
      const idx = supplierProducts.findIndex((r) => r.id === args.where.id);
      if (idx < 0) return Promise.resolve(null);
      const [removed] = supplierProducts.splice(idx, 1);
      return Promise.resolve(removed);
    }),
    findUnique: mock.fn((args: { where?: Rec; include?: Rec } = {}) => {
      const w = args?.where ?? {};
      let row: Rec | undefined;
      if (typeof w.id === 'string') row = supplierProducts.find((r) => r.id === w.id);
      else if (w.supplierId_productId) {
        const { supplierId, productId } = w.supplierId_productId as Rec;
        row = supplierProducts.find((r) => r.supplierId === supplierId && r.productId === productId);
      }
      return Promise.resolve(row ? attachIncludes(row, args.include) : null);
    }),
    findMany: makeFindMany(() => supplierProducts),
  },
  purchaseOrder: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('po'),
        status: 'DRAFT',
        totalAmount: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      purchaseOrders.push(rec);
      return Promise.resolve(rec);
    }),
    update: makeUpdate(() => purchaseOrders),
    findUnique: mock.fn((args: { where?: Rec; include?: Rec } = {}) => {
      const row = purchaseOrders.find((r) => r.id === args.where?.id);
      return Promise.resolve(row ? attachIncludes(row, args.include) : null);
    }),
    findMany: makeFindMany(() => purchaseOrders),
    count: makeCount(() => purchaseOrders),
  },
  purchaseOrderItem: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('poi'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      purchaseOrderItems.push(rec);
      return Promise.resolve(rec);
    }),
    deleteMany: mock.fn((args: { where: Rec }) => {
      const before = purchaseOrderItems.length;
      const key = Object.keys(args.where)[0]!;
      const value = Object.values(args.where)[0];
      purchaseOrderItems = purchaseOrderItems.filter(
        (r) => r[key] !== value,
      );
      return Promise.resolve({ count: before - purchaseOrderItems.length });
    }),
  },
  purchase: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('pur'),
        totalAmount: 0,
        paymentStatus: 'UNPAID',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      purchases.push(rec);
      return Promise.resolve(rec);
    }),
    update: makeUpdate(() => purchases),
    findUnique: mock.fn((args: { where?: Rec; include?: Rec } = {}) => {
      const row = purchases.find((r) => r.id === args.where?.id);
      return Promise.resolve(row ? attachIncludes(row, args.include) : null);
    }),
    findMany: makeFindMany(() => purchases),
    count: makeCount(() => purchases),
  },
  purchaseItem: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('puri'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      purchaseItems.push(rec);
      return Promise.resolve(rec);
    }),
    findMany: makeFindMany(() => purchaseItems),
  },
  supplierCreditAccount: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('ca'),
        outstandingBalance: 0,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      creditAccounts.push(rec);
      return Promise.resolve(rec);
    }),
    update: makeUpdate(() => creditAccounts),
    findUnique: mock.fn((args: { where?: Rec; include?: Rec } = {}) => {
      let row: Rec | undefined;
      if (args.where?.supplierId) row = creditAccounts.find((r) => r.supplierId === args.where?.supplierId);
      else if (args.where?.id) row = creditAccounts.find((r) => r.id === args.where?.id);
      return Promise.resolve(row ? attachIncludes(row, args.include) : null);
    }),
    findUniqueOrThrow: mock.fn(async (args: { where?: Rec } = {}) => {
      const row = args.where?.supplierId
        ? creditAccounts.find((r) => r.supplierId === args.where?.supplierId)
        : creditAccounts.find((r) => r.id === args.where?.id);
      if (!row) throw new Error('supplierCreditAccount not found');
      return row;
    }),
  },
  supplierCreditPayment: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('cp'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      creditPayments.push(rec);
      return Promise.resolve(rec);
    }),
    findMany: makeFindMany(() => creditPayments),
    count: makeCount(() => creditPayments),
  },
  inventory: {
    update: makeUpdate(() => inventories),
  },
  inventoryTransaction: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('txn'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
      inventoryTransactions.push(rec);
      return Promise.resolve(rec);
    }),
  },
  notification: {
    findFirst: makeFindFirst(() => notifications),
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('notif'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ...args.data,
      };
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
  $transaction: mock.fn((arg: unknown) => {
    if (typeof arg === 'function') return runSerialized(() => arg(db));
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

    if (sql.includes('supplier_credit_accounts')) {
      const supplierId = String(values[0] ?? '');
      const account = creditAccounts.find((a) => a.supplierId === supplierId);
      if (!account) return Promise.resolve([]);
      return Promise.resolve([{ id: account.id, outstandingBalance: account.outstandingBalance }]);
    }

    if (sql.includes('purchase_orders') && sql.includes('FOR UPDATE')) {
      const poId = String(values[0] ?? '');
      const order = purchaseOrders.find((o) => o.id === poId);
      if (!order) return Promise.resolve([]);
      return Promise.resolve([{ id: order.id }]);
    }

    const productId = String(values[0] ?? '');
    let matches = inventories.filter((i) => i.productId === productId);
    if (matches.length === 0) {
      const row: Rec = {
        id: nextId('inv'),
        productId,
        quantityOnHand: 0,
        quantityReserved: 0,
        weightedAverageCost: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      inventories.push(row);
      matches = [row];
    }
    return Promise.resolve(matches);
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

  clear(): void {
    this.cookies.clear();
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
  status: string;
  message: string;
  csrfToken: string;
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
// Fixtures
// ---------------------------------------------------------------------------

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
  categories = [
    { id: 'cat-1', name: 'Parts', slug: 'parts', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  brands = [
    { id: 'brand-1', name: 'TestBrand', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  products = [
    { id: 'prod-1', sku: 'P-1', name: 'Brake Pad', categoryId: 'cat-1', brandId: 'brand-1', retailPrice: 100, wholesalePrice: 80, minimumStock: 3, reorderLevel: 2, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'prod-2', sku: 'P-2', name: 'Chain', categoryId: 'cat-1', brandId: 'brand-1', retailPrice: 200, wholesalePrice: 150, minimumStock: 3, reorderLevel: 2, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'prod-3', sku: 'P-3', name: 'Discontinued Part', categoryId: 'cat-1', brandId: 'brand-1', retailPrice: 50, wholesalePrice: 40, minimumStock: 3, reorderLevel: 2, status: 'INACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  suppliers = [
    { id: 'sup-1', name: 'Acme Spares', contactPerson: 'Jane', phone: '+255700000001', email: 'jane@acme.test', address: 'Dar es Salaam', notes: null, status: 'ACTIVE', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    { id: 'sup-2', name: 'Old Vendor', contactPerson: null, phone: null, email: null, address: null, notes: null, status: 'INACTIVE', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
  ];
  supplierProducts = [];
  purchaseOrders = [];
  purchaseOrderItems = [];
  purchases = [];
  purchaseItems = [];
  purchaseReturns = [];
  creditAccounts = [];
  creditPayments = [];
  inventories = [];
  inventoryTransactions = [];
  notifications = [];
  documentSequences = [
    { documentType: 'PURCHASE_ORDER', prefix: 'PURCHASE_ORDER', lastNumber: 0, padLength: 6 },
    { documentType: 'PURCHASE', prefix: 'PURCHASE', lastNumber: 0, padLength: 6 },
  ];
  auditRecords.length = 0;
}

beforeEach(() => {
  seedFixtures();
});

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  txQueue = Promise.resolve();
});

function num(v: unknown): number {
  return Number(v);
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Stage 6 — supplier management', () => {
  test('ADMIN can create a supplier', async () => {
    server = await startServer();
    const jar = adminJar();
    const res = await mutate(server.port, jar, 'POST', '/api/suppliers', {
      name: 'New Vendor',
      contactPerson: 'Bob',
      phone: '+255700000009',
      email: 'bob@vendor.test',
      address: 'Mwanza',
      notes: 'preferred',
    });
    assert.equal(res.status, 201);
    assert.equal((res.body.supplier as Rec).name, 'New Vendor');
    assert.equal(suppliers.length, 3);
    assert.equal(auditRecords.some((a) => a.action === 'SUPPLIER_CREATED'), true);
  });

  test('ASSISTANT cannot create a supplier (403)', async () => {
    server = await startServer();
    const res = await mutate(server.port, assistantJar(), 'POST', '/api/suppliers', { name: 'Nope' });
    assert.equal(res.status, 403);
    assert.equal(suppliers.length, 2);
  });

  test('ASSISTANT can list and view suppliers', async () => {
    server = await startServer();
    const jar = assistantJar();
    const list = await request(server.port, jar, 'GET', '/api/suppliers');
    assert.equal(list.status, 200);
    assert.equal((list.body.items as Rec[]).length, 2);
    const detail = await request(server.port, jar, 'GET', '/api/suppliers/sup-1');
    assert.equal(detail.status, 200);
    assert.equal((detail.body.supplier as Rec).name, 'Acme Spares');
  });

  test('ADMIN can deactivate and reactivate a supplier (audited)', async () => {
    server = await startServer();
    const jar = adminJar();
    const off = await mutate(server.port, jar, 'POST', '/api/suppliers/sup-1/status', { status: 'INACTIVE' });
    assert.equal(off.status, 200);
    assert.equal(suppliers.find((s) => s.id === 'sup-1')?.status, 'INACTIVE');
    const on = await mutate(server.port, jar, 'POST', '/api/suppliers/sup-1/status', { status: 'ACTIVE' });
    assert.equal(on.status, 200);
    assert.equal(auditRecords.filter((a) => a.action === 'SUPPLIER_DEACTIVATED').length, 1);
    assert.equal(auditRecords.filter((a) => a.action === 'SUPPLIER_ACTIVATED').length, 1);
  });

  test('list suppliers filters by status and searches by name', async () => {
    server = await startServer();
    const jar = assistantJar();
    const active = await request(server.port, jar, 'GET', '/api/suppliers?status=ACTIVE');
    assert.equal((active.body.items as Rec[]).length, 1);
    const search = await request(server.port, jar, 'GET', '/api/suppliers?q=acme');
    assert.equal((search.body.items as Rec[]).length, 1);
    assert.equal((search.body.items as Rec[])[0]!.name, 'Acme Spares');
  });
});

describe('Stage 6 — supplier products', () => {
  test('ADMIN can link a product to a supplier with part number and price', async () => {
    server = await startServer();
    const jar = adminJar();
    const res = await mutate(server.port, jar, 'POST', '/api/suppliers/sup-1/products', {
      productId: 'prod-1',
      supplierPartNumber: 'ACM-101',
      unitCost: 60,
      isPreferred: true,
    });
    assert.equal(res.status, 201);
    const link = res.body.supplierProduct as Rec;
    assert.equal(link.supplierPartNumber, 'ACM-101');
    assert.equal(num(link.unitCost), 60);
    assert.equal(supplierProducts.length, 1);
    assert.equal(auditRecords.some((a) => a.action === 'SUPPLIER_PRODUCT_LINKED'), true);
  });

  test('duplicate product link is rejected (409)', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/suppliers/sup-1/products', { productId: 'prod-1' });
    const res = await mutate(server.port, jar, 'POST', '/api/suppliers/sup-1/products', { productId: 'prod-1' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'SUPPLIER_PRODUCT_EXISTS');
  });

  test('cannot link an inactive product (409)', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/suppliers/sup-1/products', { productId: 'prod-3' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'PRODUCT_INACTIVE');
  });

  test('cannot link products to an inactive supplier', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/suppliers/sup-2/products', { productId: 'prod-1' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'SUPPLIER_INACTIVE');
  });

  test('ASSISTANT cannot link a supplier product (403)', async () => {
    server = await startServer();
    const res = await mutate(server.port, assistantJar(), 'POST', '/api/suppliers/sup-1/products', { productId: 'prod-1' });
    assert.equal(res.status, 403);
    assert.equal(supplierProducts.length, 0);
  });

  test('ADMIN can update and unlink a supplier product', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/suppliers/sup-1/products', { productId: 'prod-1' });
    const linkId = supplierProducts[0]!.id as string;
    const upd = await mutate(server.port, jar, 'PATCH', `/api/supplier-products/${linkId}`, {
      unitCost: 55,
      isPreferred: true,
    });
    assert.equal(upd.status, 200);
    assert.equal(num((upd.body.supplierProduct as Rec).unitCost), 55);
    const del = await mutate(server.port, jar, 'DELETE', `/api/supplier-products/${linkId}`);
    assert.equal(del.status, 200);
    assert.equal(supplierProducts.length, 0);
    assert.equal(auditRecords.some((a) => a.action === 'SUPPLIER_PRODUCT_UNLINKED'), true);
  });

  test('supplier detail includes linked products', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/suppliers/sup-1/products', {
      productId: 'prod-1',
      supplierPartNumber: 'ACM-101',
    });
    const res = await request(server.port, assistantJar(), 'GET', '/api/suppliers/sup-1');
    assert.equal(res.status, 200);
    assert.equal(((res.body.supplier as Rec).products as Rec[]).length, 1);
    assert.equal((((res.body.supplier as Rec).products as Rec[])[0]!.product as Rec).sku, 'P-1');
  });
});

describe('Stage 6 — purchase orders', () => {
  test('create a draft PO assigns a sequential document number', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantityOrdered: 10, unitCost: 55 }],
    });
    assert.equal(res.status, 201);
    const po = res.body.purchaseOrder as Rec;
    assert.equal(po.orderNumber, 'PURCHASE_ORDER-000001');
    assert.equal(po.status, 'DRAFT');
    assert.equal(num(po.totalAmount), 550);
  });

  test('document numbers increment across orders (never reused)', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-1', quantityOrdered: 1, unitCost: 10 }],
    });
    const res = await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-2', quantityOrdered: 2, unitCost: 20 }],
    });
    assert.equal((res.body.purchaseOrder as Rec).orderNumber, 'PURCHASE_ORDER-000002');
  });

  test('ASSISTANT can create a draft PO', async () => {
    server = await startServer();
    const res = await mutate(server.port, assistantJar(), 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    assert.equal(res.status, 201);
  });

  test('cannot create a PO for an inactive supplier', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchase-orders', {
      supplierId: 'sup-2',
      items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'SUPPLIER_INACTIVE');
  });

  test('duplicate product in PO items is rejected', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1',
      items: [
        { productId: 'prod-1', quantityOrdered: 5, unitCost: 55 },
        { productId: 'prod-1', quantityOrdered: 3, unitCost: 55 },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'DUPLICATE_PURCHASE_ORDER_ITEM');
  });

  test('cannot order an inactive product', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1',
      items: [{ productId: 'prod-3', quantityOrdered: 5, unitCost: 55 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'PRODUCT_INACTIVE');
  });

  test('only ADMIN can submit a PO', async () => {
    server = await startServer();
    const jar = adminJar();
    const created = await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;

    const denied = await mutate(server.port, assistantJar(), 'POST', `/api/purchase-orders/${poId}/submit`);
    assert.equal(denied.status, 403);

    const ok = await mutate(server.port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);
    assert.equal(ok.status, 200);
    assert.equal((ok.body.purchaseOrder as Rec).status, 'PENDING');
    assert.equal(purchaseOrders.find((o) => o.id === poId)?.status, 'PENDING');
  });

  test('submitting twice is rejected', async () => {
    server = await startServer();
    const jar = adminJar();
    const created = await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;
    await mutate(server.port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);
    const res = await mutate(server.port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'INVALID_PURCHASE_ORDER_STATUS');
  });

  test('only DRAFT POs can be edited', async () => {
    server = await startServer();
    const jar = adminJar();
    const created = await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;
    await mutate(server.port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);
    const res = await mutate(server.port, jar, 'PATCH', `/api/purchase-orders/${poId}`, {
      notes: 'changed',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'INVALID_PURCHASE_ORDER_STATUS');
  });

  test('editing a draft replaces its items and recomputes the total', async () => {
    server = await startServer();
    const jar = adminJar();
    const created = await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;
    const res = await mutate(server.port, jar, 'PATCH', `/api/purchase-orders/${poId}`, {
      items: [
        { productId: 'prod-1', quantityOrdered: 10, unitCost: 55 },
        { productId: 'prod-2', quantityOrdered: 4, unitCost: 150 },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(num((res.body.purchaseOrder as Rec).totalAmount), 550 + 600);
    assert.equal(purchaseOrderItems.filter((i) => i.purchaseOrderId === poId).length, 2);
  });

  test('PENDING PO can be cancelled; CANCELLED cannot be received', async () => {
    server = await startServer();
    const jar = adminJar();
    const created = await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;
    await mutate(server.port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);
    const cancelled = await mutate(server.port, jar, 'POST', `/api/purchase-orders/${poId}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal((cancelled.body.purchaseOrder as Rec).status, 'CANCELLED');

    const receive = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: purchaseOrderItems[0]!.id, productId: 'prod-1', quantityReceived: 5 }],
    });
    assert.equal(receive.status, 409);
    assert.equal(receive.body.error?.code, 'INVALID_PURCHASE_ORDER_STATUS');
  });

  test('list POs filters by status and supplier', async () => {
    server = await startServer();
    const jar = adminJar();
    const created = await mutate(server.port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1', items: [{ productId: 'prod-1', quantityOrdered: 5, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;
    await mutate(server.port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);

    const drafts = await request(server.port, assistantJar(), 'GET', '/api/purchase-orders?status=DRAFT');
    assert.equal((drafts.body.items as Rec[]).length, 0);
    const pending = await request(server.port, assistantJar(), 'GET', '/api/purchase-orders?status=PENDING');
    assert.equal((pending.body.items as Rec[]).length, 1);
    const bySupplier = await request(server.port, assistantJar(), 'GET', '/api/purchase-orders?supplierId=sup-1');
    assert.equal((bySupplier.body.items as Rec[]).length, 1);
  });
});

describe('Stage 6 — receiving (purchase from PO)', () => {
  async function createSubmittedPo(port: number, jar: CookieJar): Promise<{ poId: string; poItemId: string }> {
    const created = await mutate(port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantityOrdered: 10, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;
    await mutate(port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);
    const poItemId = purchaseOrderItems.find((i) => i.purchaseOrderId === poId)?.id as string;
    return { poId, poItemId };
  }

  test('partial receiving creates a purchase, stocks accepted units, PO → PARTIALLY_RECEIVED', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);

    const res = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      invoiceReference: 'INV-9001',
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 6, quantityDamaged: 1 }],
    });
    assert.equal(res.status, 201);
    const purchase = res.body.purchase as Rec;
    assert.equal(purchase.purchaseNumber, 'PURCHASE-000001');
    assert.equal(num(purchase.totalAmount), 5 * 55); // only accepted (6 - 1) is billed
    assert.equal(purchases.length, 1);
    assert.equal(purchaseOrders.find((o) => o.id === poId)?.status, 'PARTIALLY_RECEIVED');

    const inv = inventories.find((i) => i.productId === 'prod-1');
    assert.equal(inv?.quantityOnHand, 5);
    assert.equal(inventoryTransactions.filter((t) => t.type === 'PURCHASE').length, 1);
    assert.equal(inventoryTransactions[0]!.quantity, 5);
  });

  test('over-receiving beyond the ordered quantity is rejected', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    const res = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 11 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'RECEIVED_QUANTITY_EXCEEDS_ORDERED');
    assert.equal(purchases.length, 0);
    assert.equal(inventories.length, 0);
  });

  test('damaged + missing exceeding received quantity is rejected', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    const res = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 5, quantityDamaged: 3, quantityMissing: 3 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'INVALID_RECEIVING_QUANTITY');
  });

  test('cumulative receives cannot exceed the ordered quantity', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 6 }],
    });
    const res = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 5 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'RECEIVED_QUANTITY_EXCEEDS_ORDERED');
    assert.equal(purchases.length, 1);
  });

  test('fully receiving marks the PO as RECEIVED', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 6 }],
    });
    const res = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 4 }],
    });
    assert.equal(res.status, 201);
    assert.equal(purchaseOrders.find((o) => o.id === poId)?.status, 'RECEIVED');
  });

  test('receiving against a fully received PO is rejected', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 10 }],
    });
    const res = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 1 }],
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'PURCHASE_ORDER_ALREADY_RECEIVED');
  });

  test('received product must match the PO line product', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    const res = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-2', quantityReceived: 5 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'INVALID_RECEIVING_QUANTITY');
  });

  test('ASSISTANT cannot receive goods (403)', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    const res = await mutate(server.port, assistantJar(), 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 5 }],
    });
    assert.equal(res.status, 403);
    assert.equal(purchases.length, 0);
  });

  test('direct purchase (no PO) requires a supplier and unit cost', async () => {
    server = await startServer();
    const jar = adminJar();
    const missingCost = await mutate(server.port, jar, 'POST', '/api/purchases', {
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantityReceived: 4 }],
    });
    assert.equal(missingCost.status, 400);
    assert.equal(missingCost.body.error?.code, 'INVALID_RECEIVING_QUANTITY');

    const missingSupplier = await mutate(server.port, jar, 'POST', '/api/purchases', {
      items: [{ productId: 'prod-1', quantityReceived: 4, quantityOrdered: 4, unitCost: 55 }],
    });
    assert.equal(missingSupplier.status, 400);

    const ok = await mutate(server.port, jar, 'POST', '/api/purchases', {
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantityReceived: 4, quantityOrdered: 4, unitCost: 55 }],
    });
    assert.equal(ok.status, 201);
    assert.equal(purchases.length, 1);
    assert.equal(num((ok.body.purchase as Rec).totalAmount), 220);
  });

  test('purchase list and detail are readable by ASSISTANT', async () => {
    server = await startServer();
    const jar = adminJar();
    const { poId, poItemId } = await createSubmittedPo(server.port, jar);
    const created = await mutate(server.port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 6 }],
    });
    const purchaseId = (created.body.purchase as Rec).id as string;

    const list = await request(server.port, assistantJar(), 'GET', '/api/purchases');
    assert.equal(list.status, 200);
    assert.equal((list.body.items as Rec[]).length, 1);

    const detail = await request(server.port, assistantJar(), 'GET', `/api/purchases/${purchaseId}`);
    assert.equal(detail.status, 200);
    const items = (detail.body.purchase as Rec).items as Rec[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.quantityReceived, 6);
    assert.equal(items[0]!.quantityAccepted, 6);
    assert.equal((items[0]!.product as Rec).sku, 'P-1');
  });
});

describe('Stage 6 — supplier credit', () => {
  async function receiveWithCredit(port: number, jar: CookieJar): Promise<string> {
    const created = await mutate(port, jar, 'POST', '/api/purchase-orders', {
      supplierId: 'sup-1',
      items: [{ productId: 'prod-1', quantityOrdered: 10, unitCost: 55 }],
    });
    const poId = (created.body.purchaseOrder as Rec).id as string;
    await mutate(port, jar, 'POST', `/api/purchase-orders/${poId}/submit`);
    const poItemId = purchaseOrderItems.find((i) => i.purchaseOrderId === poId)?.id as string;
    const received = await mutate(port, jar, 'POST', '/api/purchases', {
      purchaseOrderId: poId,
      items: [{ purchaseOrderItemId: poItemId, productId: 'prod-1', quantityReceived: 10 }],
    });
    return (received.body.purchase as Rec).id as string;
  }

  test('opening a credit account requires ADMIN and charges receive to credit', async () => {
    server = await startServer();
    const jar = adminJar();

    const denied = await mutate(server.port, assistantJar(), 'POST', '/api/supplier-credit/sup-1/account');
    assert.equal(denied.status, 403);

    const opened = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    assert.equal(opened.status, 201);

    await receiveWithCredit(server.port, jar);
    const account = creditAccounts.find((a) => a.supplierId === 'sup-1');
    assert.equal(num(account?.outstandingBalance), 550);
    const purchase = purchases[0]!;
    assert.equal(purchase.creditAccountId, account?.id);
    assert.equal(purchase.paymentStatus, 'UNPAID');
  });

  test('payment within balance reduces the outstanding balance', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    const purchaseId = await receiveWithCredit(server.port, jar);

    const res = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', {
      purchaseId,
      amount: 200,
      paymentMethod: 'CASH',
      reference: 'PAY-1',
    });
    assert.equal(res.status, 201);
    assert.equal(num(creditAccounts.find((a) => a.supplierId === 'sup-1')?.outstandingBalance), 350);
    assert.equal(purchases.find((p) => p.id === purchaseId)?.paymentStatus, 'PARTIAL');
    assert.equal(auditRecords.some((a) => a.action === 'SUPPLIER_CREDIT_PAYMENT_RECORDED'), true);
  });

  test('overpayment beyond the outstanding balance is rejected', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    await receiveWithCredit(server.port, jar);

    const res = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', {
      amount: 600,
      paymentMethod: 'BANK',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'SUPPLIER_PAYMENT_EXCEEDS_BALANCE');
    assert.equal(num(creditAccounts.find((a) => a.supplierId === 'sup-1')?.outstandingBalance), 550);
  });

  test('paying off a purchase marks it PAID', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    const purchaseId = await receiveWithCredit(server.port, jar);

    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', {
      purchaseId,
      amount: 300,
      paymentMethod: 'CASH',
    });
    const res = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', {
      purchaseId,
      amount: 250,
      paymentMethod: 'MPESA',
    });
    assert.equal(res.status, 201);
    assert.equal(purchases.find((p) => p.id === purchaseId)?.paymentStatus, 'PAID');
    assert.equal(num(creditAccounts.find((a) => a.supplierId === 'sup-1')?.outstandingBalance), 0);
  });

  test('payment cannot exceed a specific purchase remaining amount', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    const purchaseId = await receiveWithCredit(server.port, jar);
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', {
      purchaseId,
      amount: 300,
      paymentMethod: 'CASH',
    });
    const res = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', {
      purchaseId,
      amount: 400,
      paymentMethod: 'BANK',
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error?.code, 'SUPPLIER_PAYMENT_EXCEEDS_BALANCE');
  });

  test('ASSISTANT cannot record a payment (403)', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    await receiveWithCredit(server.port, jar);
    const res = await mutate(server.port, assistantJar(), 'POST', '/api/supplier-credit/sup-1/payments', {
      amount: 100,
      paymentMethod: 'CASH',
    });
    assert.equal(res.status, 403);
    assert.equal(creditPayments.length, 0);
  });

  test('balance can never go negative across a series of payments', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    await receiveWithCredit(server.port, jar); // balance 550

    const ok1 = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', { amount: 250, paymentMethod: 'CASH' });
    const ok2 = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', { amount: 300, paymentMethod: 'BANK' });
    assert.equal(ok1.status, 201);
    assert.equal(ok2.status, 201);
    const over = await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', { amount: 1, paymentMethod: 'CASH' });
    assert.equal(over.status, 409);
    const balance = num(creditAccounts.find((a) => a.supplierId === 'sup-1')?.outstandingBalance);
    assert.equal(balance, 0);
  });

  test('no credit account means receiving does not open one automatically', async () => {
    server = await startServer();
    const jar = adminJar();
    await receiveWithCredit(server.port, jar);
    assert.equal(creditAccounts.length, 0);
    assert.equal(purchases[0]!.creditAccountId, null);
  });

  test('credit payment list and summary are visible to ASSISTANT', async () => {
    server = await startServer();
    const jar = adminJar();
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/account');
    const purchaseId = await receiveWithCredit(server.port, jar);
    await mutate(server.port, jar, 'POST', '/api/supplier-credit/sup-1/payments', {
      purchaseId, amount: 100, paymentMethod: 'MPESA',
    });

    const summary = await request(server.port, assistantJar(), 'GET', '/api/supplier-credit/sup-1');
    assert.equal(summary.status, 200);
    assert.equal(num((summary.body.creditAccount as Rec).outstandingBalance), 450);

    const payments = await request(server.port, assistantJar(), 'GET', '/api/supplier-credit/sup-1/payments');
    assert.equal(payments.status, 200);
    assert.equal((payments.body.items as Rec[]).length, 1);
    assert.equal(num((payments.body.items as Rec[])[0]!.amount), 100);
  });
});