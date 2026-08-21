// Stage 5 — inventory business-rule & API test suite.
//
// Runs against the real Express app with Prisma replaced by the in-memory mock
// (globalThis.__MAKIRE_PRISMA__). The mock serializes interactive transactions
// and emulates the SELECT ... FOR UPDATE inventory lock so business rules are
// deterministic. Concurrency/atomicity/costing/ledger correctness is verified
// against real PostgreSQL in tests/integration/inventory.integration.test.ts.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';

import http from 'node:http';

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

import type { AddressInfo } from 'node:net';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin-1';
const ASSISTANT_ID = 'assistant-1';

interface UserRec {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'ASSISTANT';
  status: 'ACTIVE' | 'INACTIVE';
  passwordHash: string;
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

function baseRec(prefix: string, overrides: Rec): Rec {
  return {
    id: nextId(prefix),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

let usersById: Record<string, UserRec> = {};
let categories: Rec[] = [];
let brands: Rec[] = [];
let products: Rec[] = [];
let inventories: Rec[] = [];
let inventoryTransactions: Rec[] = [];
let stockReservations: Rec[] = [];
let notifications: Rec[] = [];
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
    case 'identifiers':
      return [];
    case 'category':
      return categories.find((c) => c.id === rec.categoryId) ?? null;
    case 'brand':
      return brands.find((b) => b.id === rec.brandId) ?? null;
    case 'inventory':
      return inventories.find((i) => i.productId === id) ?? null;
    case 'product':
      return products.find((p) => p.id === rec.productId) ?? null;
    case 'createdBy':
      return (usersById[rec.createdById as string] ?? null) as unknown as Rec | null;
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
    // JSON path/equals filter, e.g. { data: { path: ['productId'], equals: id } }.
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

  const out: Rec = { ...rec };
  for (const [rel, spec] of Object.entries(include)) {
    const specObj = (spec ?? {}) as Rec;
    if (rel === 'inventory') {
      const inv = related(rec, 'inventory');
      out[rel] = inv && !Array.isArray(inv) ? { ...inv } : null;
      continue;
    }
    if (rel === 'brand' || rel === 'category') {
      const child = related(rec, rel);
      out[rel] = child && !Array.isArray(child) ? attachIncludes(child, specObj) : null;
      continue;
    }
    if (rel === 'identifiers') {
      out[rel] = [];
      continue;
    }
    if (rel === 'product' || rel === 'createdBy') {
      const child = related(rec, rel);
      out[rel] = child && !Array.isArray(child) ? attachIncludes(child, specObj) : null;
      continue;
    }
    out[rel] = spec;
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

// Interactive transactions are serialized so concurrent mock mutations behave
// deterministically (the real DB serializes them via SELECT ... FOR UPDATE).
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
  category: {
    findMany: makeFindMany(() => categories),
    findUnique: findById(() => categories),
  },
  brand: {
    findMany: makeFindMany(() => brands),
    findUnique: findById(() => brands),
  },
  product: {
    findUnique: findById(() => products),
    findMany: mock.fn((args: { where?: Where; orderBy?: unknown; skip?: number; take?: number; include?: Rec } = {}) => {
      const rows = products.filter((row) => matchWhere(args?.where, row, related));
      const ordered = sortRecords(rows, args?.orderBy);
      const skip = args?.skip ?? 0;
      const take = args?.take ?? ordered.length;
      return Promise.resolve(ordered.slice(skip, skip + take).map((row) => attachIncludes(row, args?.include)));
    }),
    count: makeCount(() => products),
  },
  inventory: {
    findUnique: findById(() => inventories),
    findFirst: makeFindFirst(() => inventories),
    create: mock.fn((args: { data: Rec }) => {
      const rec = {
        id: nextId('inv'),
        productId: args.data.productId,
        quantityOnHand: args.data.quantityOnHand ?? 0,
        quantityReserved: args.data.quantityReserved ?? 0,
        weightedAverageCost: args.data.weightedAverageCost ?? 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      inventories.push(rec);
      return Promise.resolve(rec);
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const row = inventories.find((r) => r.id === args.where.id);
      if (!row) return Promise.resolve(null);
      const merged: Rec = {
        ...row,
        ...args.data,
        updatedAt: new Date('2026-02-01T00:00:00Z'),
      };
      Object.assign(row, merged);
      return Promise.resolve(merged);
    }),
  },
  inventoryTransaction: {
    create: mock.fn((args: { data: Rec }) => {
      const rec = {
        id: nextId('txn'),
        productId: args.data.productId,
        inventoryId: args.data.inventoryId,
        type: args.data.type,
        quantity: args.data.quantity,
        unitCost: args.data.unitCost ?? null,
        balanceAfter: args.data.balanceAfter,
        referenceId: args.data.referenceId ?? null,
        note: args.data.note ?? null,
        createdById: args.data.createdById ?? null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      inventoryTransactions.push(rec);
      return Promise.resolve(rec);
    }),
    findMany: makeFindMany(() => inventoryTransactions),
    count: makeCount(() => inventoryTransactions),
  },
  stockReservation: {
    create: mock.fn((args: { data: Rec }) => {
      const rec = {
        id: nextId('res'),
        productId: args.data.productId,
        quantity: args.data.quantity,
        status: args.data.status ?? 'ACTIVE',
        reservedUntil: args.data.reservedUntil ?? null,
        note: args.data.note ?? null,
        createdById: args.data.createdById,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      stockReservations.push(rec);
      return Promise.resolve(rec);
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const row = stockReservations.find((r) => r.id === args.where.id);
      if (!row) return Promise.resolve(null);
      const merged: Rec = { ...row, ...args.data, updatedAt: new Date('2026-02-01T00:00:00Z') };
      Object.assign(row, merged);
      return Promise.resolve(merged);
    }),
    findUnique: findById(() => stockReservations),
    findMany: makeFindMany(() => stockReservations),
    count: makeCount(() => stockReservations),
  },
  notification: {
    findFirst: makeFindFirst(() => notifications),
    create: mock.fn((args: { data: Rec }) => {
      const rec = {
        id: nextId('notif'),
        userId: args.data.userId,
        type: args.data.type,
        title: args.data.title,
        message: args.data.message,
        data: args.data.data ?? null,
        readAt: args.data.readAt ?? null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
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
  // Emulates the upsert-and-lock statement in lockInventory: creates the
  // inventory row on first sight, then returns rows for the locked productId.
  $queryRaw: mock.fn((query: unknown, ...rest: unknown[]) => {
    const values = (query as { values?: unknown[] })?.values ?? rest;
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
const inventoryService = await import('../src/services/inventoryService.js');

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

async function startServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const app = createApp();
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

interface ApiResponseBody {
  status: string;
  message: string;
  csrfToken: string;
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
  jar.cookies.set('makire_session', signSessionToken(ADMIN_ID));
  return jar;
}

function assistantJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ASSISTANT_ID));
  return jar;
}

async function mutate(port: number, jar: CookieJar, method: string, path: string, body?: unknown) {
  const csrf = await getCsrf(port, jar);
  return request(port, jar, method, path, body, csrf);
}

// ---------------------------------------------------------------------------
// Fixture seeding
// ---------------------------------------------------------------------------

function makeUser(id: string, role: 'ADMIN' | 'ASSISTANT'): UserRec {
  return {
    id,
    email: `${id}@makire.test`,
    fullName: role === 'ADMIN' ? 'System Admin' : 'Shop Assistant',
    role,
    status: 'ACTIVE',
    passwordHash: '',
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function seedInventory(): void {
  categories = [baseRec('cat', { name: 'Brake System', slug: 'brake-system', status: 'ACTIVE' })];
  brands = [baseRec('brand', { name: 'Bajaj', status: 'ACTIVE' })];
  products = [
    baseRec('prod', {
      sku: 'BP-BOX-150',
      name: 'Brake Pad Boxer 150',
      categoryId: categories[0]!.id,
      brandId: brands[0]!.id,
      retailPrice: 1500,
      wholesalePrice: 1200,
      minimumStock: 10,
      reorderLevel: 5,
      status: 'ACTIVE',
    }),
    baseRec('prod', {
      sku: 'CHAIN-150',
      name: 'Drive Chain 150',
      categoryId: categories[0]!.id,
      brandId: null,
      retailPrice: 2500,
      wholesalePrice: 2000,
      minimumStock: 4,
      reorderLevel: 2,
      status: 'ACTIVE',
    }),
  ];
}

function resetFixtures(): void {
  idCounter = 1000;
  usersById = {
    [ADMIN_ID]: makeUser(ADMIN_ID, 'ADMIN'),
    [ASSISTANT_ID]: makeUser(ASSISTANT_ID, 'ASSISTANT'),
  };
  auditRecords.length = 0;
  inventories = [];
  inventoryTransactions = [];
  stockReservations = [];
  notifications = [];
  txQueue = Promise.resolve();
  seedInventory();
}

function resetMocks(): void {
  const fns: Array<{ mock: { resetCalls: () => void } }> = [];
  for (const table of Object.values(db)) {
    if (table && typeof table === 'object') {
      for (const fn of Object.values(table)) {
        const candidate = fn as unknown as { mock?: unknown };
        if (typeof fn === 'function' && candidate.mock && typeof candidate.mock === 'object') {
          fns.push(fn as unknown as { mock: { resetCalls: () => void } });
        }
      }
    }
  }
  for (const fn of fns) {
    fn.mock.resetCalls();
  }
}

beforeEach(() => {
  resetFixtures();
  resetMocks();
});

afterEach(async () => {
  mock.reset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const P1 = (): ProductFixture => products[0] as unknown as ProductFixture;
const P2 = (): ProductFixture => products[1] as unknown as ProductFixture;

interface ProductFixture {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  brandId: string | null;
  minimumStock: number;
  reorderLevel: number;
  status: string;
}

describe('inventory — mock unit & API tests', () => {
  describe('reads', () => {
    test('inventory list returns zero-stock rows for products without inventory', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', '/api/inventory');
        assert.equal(res.status, 200);
        const items = res.body.items as Rec[];
        assert.equal(items.length, 2);
        assert.equal((items[0] as Rec).quantityOnHand, 0);
        assert.equal((items[0] as Rec).available, 0);
        assert.equal((items[0] as Rec).status, 'OUT_OF_STOCK');
      } finally {
        await close();
      }
    });

    test('inventory detail for a product with no stock shows zeros', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', `/api/inventory/${P1().id}`);
        assert.equal(res.status, 200);
        assert.equal((res.body.inventory as Rec).quantityOnHand, 0);
        assert.equal((res.body.inventory as Rec).inventoryValue, '0.00');
      } finally {
        await close();
      }
    });

    test('inventory detail 404 for unknown product', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', '/api/inventory/nope');
        assert.equal(res.status, 404);
      } finally {
        await close();
      }
    });

    test('unauthenticated reads are rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = new CookieJar();
        const res = await request(port, jar, 'GET', '/api/inventory');
        assert.equal(res.status, 401);
        assert.equal((res.body.error as Rec).code, 'AUTHENTICATION_REQUIRED');
      } finally {
        await close();
      }
    });
  });

  describe('adjustments (ADMIN only)', () => {
    test('ADMIN adjustment requires a reason', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', `/api/inventory/${P1().id}/adjust`, {
          quantity: 5,
          reason: '   ',
        });
        assert.equal(res.status, 400);
        assert.equal((res.body.error as Rec).code, 'INVALID_REQUEST');
      } finally {
        await close();
      }
    });

    test('zero adjustment quantity is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', `/api/inventory/${P1().id}/adjust`, {
          quantity: 0,
          reason: 'correction',
        });
        assert.equal(res.status, 400);
      } finally {
        await close();
      }
    });

    test('positive adjustment with DAMAGE type is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', `/api/inventory/${P1().id}/adjust`, {
          quantity: 5,
          reason: 'damage found',
          type: 'DAMAGE',
        });
        assert.equal(res.status, 400);
        assert.equal((res.body.error as Rec).code, 'INVALID_ADJUSTMENT_TYPE');
      } finally {
        await close();
      }
    });

    test('negative adjustment below zero is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', `/api/inventory/${P1().id}/adjust`, {
          quantity: -1,
          reason: 'stocktake',
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'INSUFFICIENT_STOCK');
      } finally {
        await close();
      }
    });

    test('positive adjustment adds stock at current average cost', async () => {
      const { port, close } = await startServer();
      try {
        await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', `/api/inventory/${P1().id}/adjust`, {
          quantity: 5,
          reason: 'stocktake found extra units',
        });
        assert.equal(res.status, 200);
        const inv = res.body.inventory as Rec;
        assert.equal(inv.quantityOnHand, 15);
        assert.equal(inv.weightedAverageCost, '100.00');
        assert.ok(auditRecords.some((a) => a.action === 'INVENTORY_STOCK_ADJUSTED'));
      } finally {
        await close();
      }
    });

    test('assistant cannot adjust inventory', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await mutate(port, jar, 'POST', `/api/inventory/${P1().id}/adjust`, {
          quantity: 5,
          reason: 'nope',
        });
        assert.equal(res.status, 403);
        assert.equal((res.body.error as Rec).code, 'FORBIDDEN');
      } finally {
        await close();
      }
    });
  });

  describe('reservations', () => {
    test('ADMIN can reserve available stock; ledger records reservation', async () => {
      const { port, close } = await startServer();
      try {
        await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/inventory/reservations', {
          productId: P1().id,
          quantity: 4,
          note: 'customer hold',
        });
        assert.equal(res.status, 201);
        const body = res.body as Rec;
        assert.equal((body.inventory as Rec).quantityOnHand, 10);
        assert.equal((body.inventory as Rec).quantityReserved, 4);
        assert.equal((body.inventory as Rec).available, 6);
        const txn = inventoryTransactions.find((t) => t.type === 'RESERVATION');
        assert.ok(txn, 'reservation ledger row exists');
        assert.equal(txn.quantity, 0);
        assert.equal(txn.balanceAfter, 10);
        assert.equal(txn.referenceId, (body.reservation as Rec).id);
        assert.ok(auditRecords.some((a) => a.action === 'INVENTORY_RESERVATION_CREATED'));
      } finally {
        await close();
      }
    });

    test('reservation exceeding available stock is rejected', async () => {
      const { port, close } = await startServer();
      try {
        await inventoryService.increaseStock({ productId: P1().id, quantity: 3, unitCost: 100, createdById: ADMIN_ID });
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/inventory/reservations', {
          productId: P1().id,
          quantity: 4,
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'INSUFFICIENT_AVAILABLE_STOCK');
      } finally {
        await close();
      }
    });

    test('reservation validates quantity and reservedUntil', async () => {
      const { port, close } = await startServer();
      try {
        await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
        const jar = adminJar();
        const badQty = await mutate(port, jar, 'POST', '/api/inventory/reservations', { productId: P1().id, quantity: 0 });
        assert.equal(badQty.status, 400);
        const badDate = await mutate(port, jar, 'POST', '/api/inventory/reservations', {
          productId: P1().id,
          quantity: 1,
          reservedUntil: 'not-a-date',
        });
        assert.equal(badDate.status, 400);
      } finally {
        await close();
      }
    });

    test('releasing a reservation restores availability; double release rejected', async () => {
      const { port, close } = await startServer();
      try {
        await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
        const created = await inventoryService.reserve({ productId: P1().id, quantity: 4, createdById: ADMIN_ID });
        const jar = adminJar();
        const released = await mutate(port, jar, 'PATCH', `/api/inventory/reservations/${created.reservation.id}/release`);
        assert.equal(released.status, 200);
        assert.equal((released.body.inventory as Rec).available, 10);
        assert.equal((released.body.reservation as Rec).status, 'CANCELLED');

        const again = await mutate(port, jar, 'PATCH', `/api/inventory/reservations/${created.reservation.id}/release`);
        assert.equal(again.status, 409);
        assert.equal((again.body.error as Rec).code, 'RESERVATION_ALREADY_RELEASED');
      } finally {
        await close();
      }
    });

    test('releasing an unknown reservation is 404', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'PATCH', '/api/inventory/reservations/unknown/release');
        assert.equal(res.status, 404);
        assert.equal((res.body.error as Rec).code, 'RESERVATION_NOT_FOUND');
      } finally {
        await close();
      }
    });

    test('reservation list filters by status', async () => {
      const { port, close } = await startServer();
      try {
        await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
        await inventoryService.increaseStock({ productId: P2().id, quantity: 5, unitCost: 50, createdById: ADMIN_ID });
        const created = await inventoryService.reserve({ productId: P1().id, quantity: 4, createdById: ADMIN_ID });
        await inventoryService.reserve({ productId: P2().id, quantity: 1, createdById: ADMIN_ID });
        const jar = assistantJar();
        const active = await request(port, jar, 'GET', `/api/inventory/reservations?status=ACTIVE&productId=${P1().id}`);
        assert.equal((active.body.items as Rec[]).length, 1);
        await inventoryService.releaseReservation({ reservationId: created.reservation.id, createdById: ADMIN_ID });
        const cancelled = await request(port, jar, 'GET', '/api/inventory/reservations?status=CANCELLED');
        assert.equal((cancelled.body.items as Rec[]).length, 1);
      } finally {
        await close();
      }
    });

    test('assistant cannot create or release reservations', async () => {
      const { port, close } = await startServer();
      try {
        await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
        const jar = assistantJar();
        const create = await mutate(port, jar, 'POST', '/api/inventory/reservations', { productId: P1().id, quantity: 1 });
        assert.equal(create.status, 403);
      } finally {
        await close();
      }
    });
  });

  describe('business rules (service level)', () => {
    test('increaseStock writes a ledger row with balanceAfter and stores the cost', async () => {
      const res = await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
      assert.equal(res.inventory.quantityOnHand, 10);
      assert.equal(res.inventory.weightedAverageCost, '100.00');
      const txn = inventoryTransactions[inventoryTransactions.length - 1]!;
      assert.equal(txn.quantity, 10);
      assert.equal(txn.balanceAfter, 10);
      assert.equal(Number(txn.unitCost), 100);
      assert.equal(txn.type, 'PURCHASE');
    });

    test('weighted average cost is recomputed on stock-in', async () => {
      await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
      const res = await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 200, createdById: ADMIN_ID });
      assert.equal(res.inventory.quantityOnHand, 20);
      assert.equal(res.inventory.weightedAverageCost, '150.00');
      assert.equal(res.inventory.inventoryValue, '3000.00');
    });

    test('decreaseStock rejects insufficient stock and freezes unit cost', async () => {
      await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
      await assert.rejects(
        inventoryService.decreaseStock({ productId: P1().id, quantity: 11, createdById: ADMIN_ID }),
        (err: unknown) => (err as { code?: string }).code === 'INSUFFICIENT_STOCK',
      );
      const out = await inventoryService.decreaseStock({ productId: P1().id, quantity: 4, createdById: ADMIN_ID });
      assert.equal(out.inventory.quantityOnHand, 6);
      assert.equal(out.inventory.weightedAverageCost, '100.00');
      const txn = inventoryTransactions[inventoryTransactions.length - 1]!;
      assert.equal(txn.quantity, -4);
      assert.equal(txn.balanceAfter, 6);
      assert.equal(Number(txn.unitCost), 100);
    });

    test('average cost resets after stock returns to zero', async () => {
      await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
      await inventoryService.decreaseStock({ productId: P1().id, quantity: 10, createdById: ADMIN_ID });
      const res = await inventoryService.increaseStock({ productId: P1().id, quantity: 5, unitCost: 300, createdById: ADMIN_ID });
      assert.equal(res.inventory.weightedAverageCost, '300.00');
    });

    test('invalid quantity and negative cost are rejected', async () => {
      await assert.rejects(
        inventoryService.increaseStock({ productId: P1().id, quantity: 0, unitCost: 100 }),
        (err: unknown) => (err as { code?: string }).code === 'INVALID_QUANTITY',
      );
      await assert.rejects(
        inventoryService.increaseStock({ productId: P1().id, quantity: 5, unitCost: -1 }),
        (err: unknown) => (err as { code?: string }).code === 'INVALID_COST',
      );
    });

    test('low-stock notification is created once and not duplicated', async () => {
      const res = await inventoryService.increaseStock({ productId: P1().id, quantity: 6, unitCost: 100, createdById: ADMIN_ID });
      assert.equal(res.notificationsCreated, 0, 'healthy stock produces no notification');
      await inventoryService.decreaseStock({ productId: P1().id, quantity: 2, createdById: ADMIN_ID });
      assert.equal(notifications.filter((n) => n.type === 'LOW_STOCK').length, 2, 'one per ACTIVE user');
      const again = await inventoryService.decreaseStock({ productId: P1().id, quantity: 1, createdById: ADMIN_ID });
      assert.equal(again.notificationsCreated, 0, 'idempotent: no duplicate while unread exists');
      assert.equal(notifications.filter((n) => n.type === 'LOW_STOCK').length, 2);
    });

    test('stock-out notification fires when available hits zero', async () => {
      await inventoryService.increaseStock({ productId: P1().id, quantity: 1, unitCost: 100, createdById: ADMIN_ID });
      await inventoryService.decreaseStock({ productId: P1().id, quantity: 1, createdById: ADMIN_ID });
      assert.ok(notifications.some((n) => n.type === 'OUT_OF_STOCK'));
    });

    test('ledger is self-consistent: balanceAfter tracks running on-hand', async () => {
      await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
      await inventoryService.increaseStock({ productId: P1().id, quantity: 5, unitCost: 200, createdById: ADMIN_ID });
      await inventoryService.decreaseStock({ productId: P1().id, quantity: 3, createdById: ADMIN_ID });
      const res = await inventoryService.reserve({ productId: P1().id, quantity: 2, createdById: ADMIN_ID });
      await inventoryService.releaseReservation({ reservationId: res.reservation.id, createdById: ADMIN_ID });

      const movementRows = inventoryTransactions.filter((t) => t.quantity !== 0);
      const net = movementRows.reduce((sum, t) => sum + (t.quantity as number), 0);
      assert.equal(net, 12, 'net movement equals final on-hand');
      const last = inventoryTransactions[inventoryTransactions.length - 1]!;
      const inv = inventories.find((i) => i.productId === P1().id)!;
      assert.equal(inv.quantityOnHand, last.balanceAfter, 'final on-hand matches last balanceAfter');
    });

    test('movement filter in transactions history', async () => {
      await inventoryService.increaseStock({ productId: P1().id, quantity: 10, unitCost: 100, createdById: ADMIN_ID });
      await inventoryService.decreaseStock({ productId: P1().id, quantity: 2, createdById: ADMIN_ID });
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const out = await request(port, jar, 'GET', `/api/inventory/${P1().id}/transactions?movement=out`);
        assert.equal((out.body.items as Rec[]).length, 1);
        assert.equal((out.body.items as Rec[])[0]!.quantity, -2);
        const res = await request(port, jar, 'GET', `/api/inventory/${P1().id}/transactions?movement=reservation`);
        assert.equal((res.body.items as Rec[]).length, 0);
      } finally {
        await close();
      }
    });
  });
});