// Stage 4 — product catalog & motorcycle compatibility test suite.
//
// Runs against the real Express app (createApp) with Prisma replaced by an
// in-memory mock via the lib/prisma test seam (globalThis.__MAKIRE_PRISMA__).
// The mock implements a subset of Prisma's query semantics (where matching
// across AND/OR, relation some/is, contains/equality filters, pagination and
// ordering) so filtering/searching behavior is genuinely exercised. Live
// database integration verification is reported separately as PENDING (no
// PostgreSQL is available in this environment).

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
let makes: Rec[] = [];
let models: Rec[] = [];
let variants: Rec[] = [];
let products: Rec[] = [];
let identifiers: Rec[] = [];
let compatibilities: Rec[] = [];
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
        break; // mock matching is already case-insensitive
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
      return identifiers.filter((i) => i.productId === id);
    case 'compatibilities':
      return compatibilities.filter((c) => c.productId === id);
    case 'category':
      return categories.find((c) => c.id === rec.categoryId) ?? null;
    case 'brand':
      return brands.find((b) => b.id === rec.brandId) ?? null;
    case 'variant':
      return variants.find((v) => v.id === rec.variantId) ?? null;
    case 'model':
      return models.find((m) => m.id === rec.modelId) ?? null;
    case 'make':
      return makes.find((m) => m.id === rec.makeId) ?? null;
    case 'parent':
      return categories.find((c) => c.id === rec.parentId) ?? null;
    case 'children':
      return categories.filter((c) => c.parentId === id);
    case 'models':
      return models.filter((m) => m.makeId === id);
    case 'variants':
      return variants.filter((v) => v.modelId === id);
    case 'products':
      return products.filter((p) => p.categoryId === id || p.brandId === id);
    case 'product':
      return products.find((p) => p.id === rec.productId) ?? null;
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
    if ('none' in v) {
      const children = Array.isArray(rel(rec, key)) ? (rel(rec, key) as Rec[]) : [];
      if (children.some((child) => matchWhere(v.none as Where, child, rel))) return false;
      continue;
    }
    // Implicit relation filter, e.g. { variant: { modelId: 'x' } } — apply to the
    // resolved relation record when the value carries no filter operators.
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
    // Scalar field filter: { contains }, { equals }, { in }, ...
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

function countRelation(rel: string, rec: Rec): number {
  const id = rec.id as string;
  if (rel === 'children') return categories.filter((c) => c.parentId === id).length;
  if (rel === 'models') return models.filter((m) => m.makeId === id).length;
  if (rel === 'variants') return variants.filter((v) => v.modelId === id).length;
  if (rel === 'compatibilities') return compatibilities.filter((c) => c.productId === id).length;
  if (rel === 'products') {
    if ('slug' in rec) return products.filter((p) => p.categoryId === id).length;
    if ('modelId' in rec) return compatibilities.filter((c) => c.variantId === id).length;
    return products.filter((p) => p.brandId === id).length;
  }
  return 0;
}

function attachIncludes(rec: Rec, include: Rec | undefined): Rec {
  if (!include) return { ...rec };
  if (include.select) return pickFields(rec, include.select as Rec);
  if (include.include) return attachIncludes(rec, include.include as Rec);

  const out: Rec = { ...rec };
  if (include._count) {
    const counts: Rec = {};
    for (const rel of Object.keys((include._count as Rec).select as Rec)) {
      counts[rel] = countRelation(rel, rec);
    }
    out._count = counts;
  }
  for (const [rel, spec] of Object.entries(include)) {
    if (rel === '_count') continue;
    const specObj = spec as Rec;
    if (rel === 'identifiers') {
      out[rel] = identifiers
        .filter((i) => i.productId === rec.id)
        .map((i) => ({ id: i.id, type: i.type, value: i.value }));
      continue;
    }
    if (rel === 'compatibilities') {
      out[rel] = compatibilities
        .filter((c) => c.productId === rec.id)
        .map((c) => attachIncludes(c, specObj));
      continue;
    }
    if (rel === 'children' || rel === 'models' || rel === 'variants') {
      const rows = related(rec, rel);
      out[rel] = (Array.isArray(rows) ? rows : []).map((row) => attachIncludes(row, specObj));
      continue;
    }
    if (
      rel === 'parent' ||
      rel === 'make' ||
      rel === 'model' ||
      rel === 'variant' ||
      rel === 'category' ||
      rel === 'brand' ||
      rel === 'product'
    ) {
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
    else if (typeof where.slug === 'string') row = getRows().find((r) => r.slug === where.slug);
    else if (typeof where.sku === 'string') row = getRows().find((r) => r.sku === where.sku);
    else if (typeof where.name === 'string') row = getRows().find((r) => r.name === where.name);
    else if (where.makeId_name) {
      const m = where.makeId_name as Rec;
      row = getRows().find((r) => r.makeId === m.makeId && r.name === m.name);
    } else if (where.modelId_name) {
      const m = where.modelId_name as Rec;
      row = getRows().find((r) => r.modelId === m.modelId && r.name === m.name);
    } else if (where.productId_variantId) {
      const m = where.productId_variantId as Rec;
      row = getRows().find((r) => r.productId === m.productId && r.variantId === m.variantId);
    }
    return Promise.resolve(row ? attachIncludes(row, args?.include) : null);
  });
}

function makeUpdate(getRows: () => Rec[]) {
  return mock.fn((args: { where: { id: string }; data: Rec; include?: Rec }) => {
    const row = getRows().find((r) => r.id === args.where.id);
    if (!row) return Promise.resolve(null);
    const merged: Rec = { ...row, ...args.data, updatedAt: new Date('2026-02-01T00:00:00Z') };
    Object.assign(row, merged);
    return Promise.resolve(attachIncludes(merged, args?.include));
  });
}

class PrismaMockError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = code;
  }
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
    update: mock.fn((args: { where: { id: string }; data: Partial<UserRec> }) => {
      const current = usersById[args.where.id];
      if (!current) return Promise.resolve(null);
      const updated: UserRec = { ...current, ...args.data, updatedAt: new Date() };
      usersById[updated.id] = updated;
      return Promise.resolve(updated);
    }),
    count: mock.fn(() => Promise.resolve(Object.values(usersById).length)),
  },
  category: {
    findUnique: findById(() => categories),
    findMany: makeFindMany(() => categories),
    findFirst: makeFindFirst(() => categories),
    count: makeCount(() => categories),
    create: mock.fn((args: { data: Rec; include?: Rec }) => {
      const parentId = args.data.parentId ?? null;
      const clash = categories.find((c) => c.name === args.data.name && c.parentId === parentId);
      if (clash) return Promise.reject(new PrismaMockError('P2002', 'unique constraint'));
      const rec = baseRec('cat', {
        name: args.data.name,
        slug: args.data.slug,
        parentId,
        description: args.data.description ?? null,
        status: args.data.status ?? 'ACTIVE',
      });
      categories.push(rec);
      return Promise.resolve(attachIncludes(rec, args?.include));
    }),
    update: makeUpdate(() => categories),
  },
  brand: {
    findUnique: findById(() => brands),
    findMany: makeFindMany(() => brands),
    count: makeCount(() => brands),
    create: mock.fn((args: { data: Rec; include?: Rec }) => {
      if (brands.some((b) => b.name === args.data.name)) {
        return Promise.reject(new PrismaMockError('P2002', 'unique constraint'));
      }
      const rec = baseRec('brand', {
        name: args.data.name,
        status: args.data.status ?? 'ACTIVE',
      });
      brands.push(rec);
      return Promise.resolve(attachIncludes(rec, args?.include));
    }),
    update: makeUpdate(() => brands),
  },
  motorcycleMake: {
    findUnique: findById(() => makes),
    findMany: makeFindMany(() => makes),
    count: makeCount(() => makes),
    create: mock.fn((args: { data: Rec; include?: Rec }) => {
      if (makes.some((m) => m.name === args.data.name)) {
        return Promise.reject(new PrismaMockError('P2002', 'unique constraint'));
      }
      const rec = baseRec('make', { name: args.data.name, status: args.data.status ?? 'ACTIVE' });
      makes.push(rec);
      return Promise.resolve(attachIncludes(rec, args?.include));
    }),
    update: makeUpdate(() => makes),
  },
  motorcycleModel: {
    findUnique: findById(() => models),
    findMany: makeFindMany(() => models),
    count: makeCount(() => models),
    create: mock.fn((args: { data: Rec; include?: Rec }) => {
      if (models.some((m) => m.makeId === args.data.makeId && m.name === args.data.name)) {
        return Promise.reject(new PrismaMockError('P2002', 'unique constraint'));
      }
      const rec = baseRec('model', {
        makeId: args.data.makeId,
        name: args.data.name,
        status: args.data.status ?? 'ACTIVE',
      });
      models.push(rec);
      return Promise.resolve(attachIncludes(rec, args?.include));
    }),
    update: makeUpdate(() => models),
  },
  motorcycleVariant: {
    findUnique: findById(() => variants),
    findMany: makeFindMany(() => variants),
    count: makeCount(() => variants),
    create: mock.fn((args: { data: Rec; include?: Rec }) => {
      if (variants.some((v) => v.modelId === args.data.modelId && v.name === args.data.name)) {
        return Promise.reject(new PrismaMockError('P2002', 'unique constraint'));
      }
      const rec = baseRec('variant', {
        modelId: args.data.modelId,
        name: args.data.name,
        yearFrom: args.data.yearFrom ?? null,
        yearTo: args.data.yearTo ?? null,
        status: args.data.status ?? 'ACTIVE',
      });
      variants.push(rec);
      return Promise.resolve(attachIncludes(rec, args?.include));
    }),
    update: makeUpdate(() => variants),
  },
  product: {
    findUnique: findById(() => products),
    findMany: makeFindMany(() => products),
    count: makeCount(() => products),
    create: mock.fn((args: { data: Rec; include?: Rec }) => {
      const data = args.data;
      const rec = baseRec('prod', {
        sku: data.sku,
        name: data.name,
        description: data.description ?? null,
        categoryId: data.categoryId,
        brandId: data.brandId ?? null,
        retailPrice: data.retailPrice ?? 0,
        wholesalePrice: data.wholesalePrice ?? 0,
        minimumStock: data.minimumStock ?? 0,
        reorderLevel: data.reorderLevel ?? 0,
        status: data.status ?? 'ACTIVE',
      });
      products.push(rec);
      const identifiersSpec = data.identifiers as Rec | undefined;
      const compatSpec = data.compatibilities as Rec | undefined;
      if (identifiersSpec?.create) {
        for (const i of identifiersSpec.create as Rec[]) {
          identifiers.push({ id: nextId('ident'), productId: rec.id, type: i.type, value: i.value, createdAt: rec.createdAt });
        }
      }
      if (compatSpec?.create) {
        for (const c of compatSpec.create as Rec[]) {
          compatibilities.push({ id: nextId('compat'), productId: rec.id, variantId: c.variantId, notes: c.notes ?? null, createdAt: rec.createdAt });
        }
      }
      return Promise.resolve(attachIncludes(rec, args?.include));
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec; include?: Rec }) => {
      const row = products.find((r) => r.id === args.where.id);
      if (!row) return Promise.resolve(null);
      const data = args.data;
      const merged: Rec = {
        ...row,
        sku: data.sku ?? row.sku,
        name: data.name ?? row.name,
        description: data.description !== undefined ? data.description : row.description,
        categoryId: data.categoryId ?? row.categoryId,
        brandId: data.brandId !== undefined ? data.brandId : row.brandId,
        retailPrice: data.retailPrice ?? row.retailPrice,
        wholesalePrice: data.wholesalePrice ?? row.wholesalePrice,
        minimumStock: data.minimumStock ?? row.minimumStock,
        reorderLevel: data.reorderLevel ?? row.reorderLevel,
        status: data.status ?? row.status,
        updatedAt: new Date('2026-02-01T00:00:00Z'),
      };
      const identifiersSpec = data.identifiers as Rec | undefined;
      if (identifiersSpec) {
        identifiers = identifiers.filter((i) => i.productId !== row.id);
        for (const i of identifiersSpec.create as Rec[]) {
          identifiers.push({ id: nextId('ident'), productId: row.id, type: i.type, value: i.value, createdAt: row.createdAt });
        }
      }
      const compatSpec = data.compatibilities as Rec | undefined;
      if (compatSpec) {
        compatibilities = compatibilities.filter((c) => c.productId !== row.id);
        for (const c of compatSpec.create as Rec[]) {
          compatibilities.push({ id: nextId('compat'), productId: row.id, variantId: c.variantId, notes: c.notes ?? null, createdAt: row.createdAt });
        }
      }
      Object.assign(row, merged);
      return Promise.resolve(attachIncludes(merged, args?.include));
    }),
  },
  productIdentifier: {
    findMany: makeFindMany(() => identifiers),
  },
  productCompatibility: {
    findUnique: findById(() => compatibilities),
    findMany: makeFindMany(() => compatibilities),
    count: makeCount(() => compatibilities),
    create: mock.fn((args: { data: Rec; include?: Rec }) => {
      const rec = baseRec('compat', {
        productId: args.data.productId,
        variantId: args.data.variantId,
        notes: args.data.notes ?? null,
      });
      compatibilities.push(rec);
      return Promise.resolve(attachIncludes(rec, args?.include));
    }),
    delete: mock.fn((args: { where: { id: string } }) => {
      const idx = compatibilities.findIndex((c) => c.id === args.where.id);
      if (idx < 0) return Promise.resolve(null);
      const [removed] = compatibilities.splice(idx, 1);
      return Promise.resolve(removed);
    }),
  },
  auditLog: {
    create: mock.fn((args: { data: Record<string, unknown> }) => {
      auditRecords.push(args.data);
      return Promise.resolve(args.data);
    }),
  },
  $transaction: mock.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  $queryRaw: mock.fn(() => Promise.resolve([])),
};

(globalThis as unknown as { __MAKIRE_PRISMA__: unknown }).__MAKIRE_PRISMA__ = db;

const { createApp } = await import('../src/app.js');
const { signSessionToken } = await import('../src/utils/tokens.js');

// ---------------------------------------------------------------------------
// Helpers
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

function seedCatalog(): void {
  categories = [
    baseRec('cat', { name: 'Brake System', slug: 'brake-system', parentId: null, description: null, status: 'ACTIVE' }),
    baseRec('cat', { name: 'Engine Parts', slug: 'engine-parts', parentId: null, description: null, status: 'ACTIVE' }),
    baseRec('cat', { name: 'Brake Pads', slug: 'brake-pads', parentId: null, description: null, status: 'ACTIVE' }),
  ];
  // Link brake-pads under brake-system for the hierarchy case.
  categories[2]!.parentId = categories[0]!.id;

  brands = [
    baseRec('brand', { name: 'Bajaj', status: 'ACTIVE' }),
    baseRec('brand', { name: 'Brembo', status: 'ACTIVE' }),
  ];

  makes = [
    baseRec('make', { name: 'Bajaj', status: 'ACTIVE' }),
    baseRec('make', { name: 'TVS', status: 'ACTIVE' }),
  ];
  models = [
    baseRec('model', { makeId: makes[0]!.id, name: 'Boxer', status: 'ACTIVE' }),
    baseRec('model', { makeId: makes[0]!.id, name: 'Pulsar', status: 'ACTIVE' }),
    baseRec('model', { makeId: makes[1]!.id, name: 'HLX', status: 'ACTIVE' }),
  ];
  variants = [
    baseRec('variant', { modelId: models[0]!.id, name: '125', yearFrom: null, yearTo: null, status: 'ACTIVE' }),
    baseRec('variant', { modelId: models[0]!.id, name: '150', yearFrom: null, yearTo: null, status: 'ACTIVE' }),
    baseRec('variant', { modelId: models[1]!.id, name: '150', yearFrom: null, yearTo: null, status: 'ACTIVE' }),
    baseRec('variant', { modelId: models[2]!.id, name: '125', yearFrom: 2015, yearTo: 2020, status: 'ACTIVE' }),
  ];

  products = [
    baseRec('prod', {
      sku: 'BP-BOX-150',
      name: 'Brake Pad Boxer 150',
      description: 'Front brake pad set',
      categoryId: categories[2]!.id,
      brandId: brands[0]!.id,
      retailPrice: 1500,
      wholesalePrice: 1200,
      minimumStock: 10,
      reorderLevel: 5,
      status: 'ACTIVE',
    }),
    baseRec('prod', {
      sku: 'BP-HLX-125',
      name: 'Brake Pad HLX 125',
      description: null,
      categoryId: categories[0]!.id,
      brandId: null,
      retailPrice: 800,
      wholesalePrice: 600,
      minimumStock: 0,
      reorderLevel: 0,
      status: 'ACTIVE',
    }),
    baseRec('prod', {
      sku: 'CHAIN-150',
      name: 'Drive Chain 150',
      description: null,
      categoryId: categories[1]!.id,
      brandId: brands[1]!.id,
      retailPrice: 2500,
      wholesalePrice: 2000,
      minimumStock: 4,
      reorderLevel: 2,
      status: 'ACTIVE',
    }),
  ];

  identifiers = [
    { id: nextId('ident'), productId: products[0]!.id, type: 'PART_NUMBER', value: 'BP-BOX-150', createdAt: new Date() },
    { id: nextId('ident'), productId: products[0]!.id, type: 'OEM_NUMBER', value: 'BJP-12345', createdAt: new Date() },
    { id: nextId('ident'), productId: products[0]!.id, type: 'ALTERNATIVE_NUMBER', value: 'BP150-A', createdAt: new Date() },
    { id: nextId('ident'), productId: products[1]!.id, type: 'PART_NUMBER', value: 'BP-HLX-125', createdAt: new Date() },
  ];

  compatibilities = [
    { id: nextId('compat'), productId: products[0]!.id, variantId: variants[1]!.id, notes: null, createdAt: new Date() },
    { id: nextId('compat'), productId: products[0]!.id, variantId: variants[3]!.id, notes: null, createdAt: new Date() },
    { id: nextId('compat'), productId: products[1]!.id, variantId: variants[3]!.id, notes: 'also fits', createdAt: new Date() },
  ];
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

function resetFixtures(): void {
  idCounter = 1000;
  usersById = {
    [ADMIN_ID]: makeUser(ADMIN_ID, 'ADMIN'),
    [ASSISTANT_ID]: makeUser(ASSISTANT_ID, 'ASSISTANT'),
  };
  auditRecords.length = 0;
  seedCatalog();
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

describe('catalog API', () => {
  describe('categories', () => {
    test('ADMIN can create a category; slug is derived; audit is recorded', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/categories', { name: 'Filters' });
        assert.equal(res.status, 201);
        const category = res.body.category as Rec;
        assert.equal(category.name, 'Filters');
        assert.equal(category.slug, 'filters');
        assert.equal(category.status, 'ACTIVE');
        assert.ok(auditRecords.some((a) => a.action === 'CATEGORY_CREATED' && a.entityId === category.id));
      } finally {
        await close();
      }
    });

    test('duplicate category name under the same parent is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        await mutate(port, jar, 'POST', '/api/categories', { name: 'Filters' });
        const res = await mutate(port, jar, 'POST', '/api/categories', { name: 'Filters' });
        assert.equal(res.status, 409);
      } finally {
        await close();
      }
    });

    test('category list is paginated and searchable', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', '/api/categories?page=1&pageSize=2');
        assert.equal(res.status, 200);
        assert.equal((res.body.items as Rec[]).length, 2);
        assert.equal((res.body.pagination as Rec).totalItems, 3);

        const search = await request(port, jar, 'GET', '/api/categories?q=brake');
        assert.equal((search.body.items as Rec[]).length, 2);
      } finally {
        await close();
      }
    });

    test('deactivating a category in use by products is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const categoryId = categories.find((c) => c.name === 'Brake Pads')!.id;
        const res = await mutate(port, jar, 'PATCH', `/api/categories/${categoryId}/status`, { status: 'INACTIVE' });
        assert.equal(res.status, 400);
        assert.equal((res.body.error as Rec).code, 'CATEGORY_IN_USE');
      } finally {
        await close();
      }
    });

    test('deactivating an unused category works and is audited', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const created = await mutate(port, jar, 'POST', '/api/categories', { name: 'Unused' });
        const id = (created.body.category as Rec).id as string;
        const res = await mutate(port, jar, 'PATCH', `/api/categories/${id}/status`, { status: 'INACTIVE' });
        assert.equal(res.status, 200);
        assert.equal((res.body.category as Rec).status, 'INACTIVE');
        assert.ok(auditRecords.some((a) => a.action === 'CATEGORY_DEACTIVATED' && a.entityId === id));
      } finally {
        await close();
      }
    });

    test('validation: empty category name is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/categories', { name: '   ' });
        assert.equal(res.status, 400);
        assert.equal((res.body.error as Rec).code, 'INVALID_REQUEST');
      } finally {
        await close();
      }
    });
  });

  describe('brands', () => {
    test('ADMIN can create, update and list brands', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const created = await mutate(port, jar, 'POST', '/api/brands', { name: 'Honda' });
        assert.equal(created.status, 201);
        const id = (created.body.brand as Rec).id as string;
        assert.ok(auditRecords.some((a) => a.action === 'BRAND_CREATED'));

        const updated = await mutate(port, jar, 'PATCH', `/api/brands/${id}`, { name: 'Honda Moto' });
        assert.equal(updated.status, 200);
        assert.equal((updated.body.brand as Rec).name, 'Honda Moto');

        const list = await request(port, jar, 'GET', '/api/brands?q=honda');
        assert.equal((list.body.items as Rec[]).length, 1);
      } finally {
        await close();
      }
    });

    test('duplicate brand name is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/brands', { name: 'Bajaj' });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_BRAND');
      } finally {
        await close();
      }
    });

    test('deactivating a brand in use by products is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const brandId = brands.find((b) => b.name === 'Bajaj')!.id;
        const res = await mutate(port, jar, 'PATCH', `/api/brands/${brandId}/status`, { status: 'INACTIVE' });
        assert.equal(res.status, 400);
        assert.equal((res.body.error as Rec).code, 'BRAND_IN_USE');
      } finally {
        await close();
      }
    });
  });

  describe('motorcycle catalog', () => {
    test('make, model and variant can be created', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const make = await mutate(port, jar, 'POST', '/api/motorcycles/makes', { name: 'Yamaha' });
        assert.equal(make.status, 201);
        const makeId = (make.body.make as Rec).id as string;

        const model = await mutate(port, jar, 'POST', '/api/motorcycles/models', { makeId, name: 'YB' });
        assert.equal(model.status, 201);
        const modelId = (model.body.model as Rec).id as string;

        const variant = await mutate(port, jar, 'POST', '/api/motorcycles/variants', {
          modelId,
          name: '125',
          yearFrom: 2010,
          yearTo: 2015,
        });
        assert.equal(variant.status, 201);
        assert.equal((variant.body.variant as Rec).yearFrom, 2010);
        assert.ok(auditRecords.some((a) => a.action === 'MOTORCYCLE_MAKE_CREATED'));
        assert.ok(auditRecords.some((a) => a.action === 'MOTORCYCLE_MODEL_CREATED'));
        assert.ok(auditRecords.some((a) => a.action === 'MOTORCYCLE_VARIANT_CREATED'));
      } finally {
        await close();
      }
    });

    test('duplicate make is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/motorcycles/makes', { name: 'Bajaj' });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_MAKE');
      } finally {
        await close();
      }
    });

    test('duplicate model within the same make is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/motorcycles/models', {
          makeId: makes[0]!.id,
          name: 'Boxer',
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_MODEL');
      } finally {
        await close();
      }
    });

    test('invalid year range is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/motorcycles/variants', {
          modelId: models[0]!.id,
          name: 'X',
          yearFrom: 2020,
          yearTo: 2010,
        });
        assert.equal(res.status, 400);
      } finally {
        await close();
      }
    });

    test('deactivating a variant used by compatibility is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'PATCH', `/api/motorcycles/variants/${variants[1]!.id}/status`, {
          status: 'INACTIVE',
        });
        assert.equal(res.status, 400);
        assert.equal((res.body.error as Rec).code, 'MOTORCYCLE_IN_USE');
      } finally {
        await close();
      }
    });

    test('variant search by make/model free text (compatibility search)', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', '/api/motorcycles/variants?make=Bajaj&model=Boxer&variant=15');
        assert.equal(res.status, 200);
        const items = res.body.items as Rec[];
        assert.equal(items.length, 1);
        assert.equal((items[0] as Rec).name, '150');
        assert.equal(((items[0] as Rec).model as Rec).name, 'Boxer');
      } finally {
        await close();
      }
    });

    test('variant list filters by makeId (cascading selection)', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', `/api/motorcycles/variants?makeId=${makes[0]!.id}`);
        assert.equal((res.body.items as Rec[]).length, 3);
        const modelsRes = await request(port, jar, 'GET', `/api/motorcycles/models?makeId=${makes[0]!.id}`);
        assert.equal((modelsRes.body.items as Rec[]).length, 2);
      } finally {
        await close();
      }
    });
  });

  describe('products', () => {
    test('ADMIN can create a product with identifiers and compatibility', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'NEW-SKU-1',
          name: 'Clutch Cable',
          description: 'OEM replacement',
          categoryId: categories[0]!.id,
          brandId: null,
          retailPrice: 900,
          wholesalePrice: 700,
          minimumStock: 5,
          reorderLevel: 2,
          identifiers: [{ type: 'PART_NUMBER', value: 'CC-100' }],
          compatibility: [{ variantId: variants[0]!.id }],
        });
        assert.equal(res.status, 201);
        const product = res.body.product as Rec;
        assert.equal(product.sku, 'NEW-SKU-1');
        assert.equal((product.identifiers as Rec[]).length, 1);
        assert.equal((product.compatibilities as Rec[]).length, 1);
        assert.equal(product.brandId, null, 'unbranded product');
        assert.ok(auditRecords.some((a) => a.action === 'PRODUCT_CREATED'));
      } finally {
        await close();
      }
    });

    test('duplicate SKU is rejected with a clean error', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'BP-BOX-150',
          name: 'Duplicate',
          categoryId: categories[0]!.id,
          retailPrice: 1,
          wholesalePrice: 1,
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_SKU');
      } finally {
        await close();
      }
    });

    test('duplicate identifier across products is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'NEW-SKU-2',
          name: 'Another',
          categoryId: categories[0]!.id,
          retailPrice: 1,
          wholesalePrice: 1,
          identifiers: [{ type: 'OEM_NUMBER', value: 'BJP-12345' }],
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_IDENTIFIER');
      } finally {
        await close();
      }
    });

    test('duplicate identifier within one request is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'NEW-SKU-3',
          name: 'Another',
          categoryId: categories[0]!.id,
          retailPrice: 1,
          wholesalePrice: 1,
          identifiers: [
            { type: 'PART_NUMBER', value: 'X-1' },
            { type: 'PART_NUMBER', value: 'X-1' },
          ],
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_IDENTIFIER');
      } finally {
        await close();
      }
    });

    test('duplicate compatibility within one request is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'NEW-SKU-4',
          name: 'Another',
          categoryId: categories[0]!.id,
          retailPrice: 1,
          wholesalePrice: 1,
          compatibility: [{ variantId: variants[0]!.id }, { variantId: variants[0]!.id }],
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_COMPATIBILITY');
      } finally {
        await close();
      }
    });

    test('product detail includes compatibility (reverse lookup: product -> motorcycles)', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', `/api/products/${products[0]!.id}`);
        assert.equal(res.status, 200);
        const compat = (res.body.product as Rec).compatibilities as Rec[];
        assert.equal(compat.length, 2);
        const variant = compat[0]!.variant as Rec;
        assert.equal((variant.model as Rec).name, 'Boxer');
        assert.equal(((variant.model as Rec).make as Rec).name, 'Bajaj');
      } finally {
        await close();
      }
    });

    test('product update replaces identifiers and emits granular audits', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'PATCH', `/api/products/${products[0]!.id}`, {
          identifiers: [
            { type: 'PART_NUMBER', value: 'BP-BOX-150' },
            { type: 'SUPPLIER_NUMBER', value: 'SUP-7788' },
          ],
        });
        assert.equal(res.status, 200);
        const identifiers2 = (res.body.product as Rec).identifiers as Rec[];
        assert.equal(identifiers2.length, 2);
        assert.ok(auditRecords.some((a) => a.action === 'IDENTIFIER_ADDED' && a.entityId === products[0]!.id));
        assert.ok(auditRecords.some((a) => a.action === 'IDENTIFIER_REMOVED' && a.entityId === products[0]!.id));
      } finally {
        await close();
      }
    });

    test('product can be deactivated and is audited', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'PATCH', `/api/products/${products[0]!.id}/status`, { status: 'INACTIVE' });
        assert.equal(res.status, 200);
        assert.equal((res.body.product as Rec).status, 'INACTIVE');
        assert.ok(auditRecords.some((a) => a.action === 'PRODUCT_DEACTIVATED'));
      } finally {
        await close();
      }
    });

    test('negative price is rejected by validation', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'NEG-1',
          name: 'Bad',
          categoryId: categories[0]!.id,
          retailPrice: -5,
          wholesalePrice: 1,
        });
        assert.equal(res.status, 400);
      } finally {
        await close();
      }
    });

    test('invalid categoryId is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'BAD-CAT-1',
          name: 'Bad',
          categoryId: 'missing-category',
          retailPrice: 1,
          wholesalePrice: 1,
        });
        assert.equal(res.status, 400);
      } finally {
        await close();
      }
    });

    test('product search matches name, identifier, brand and category', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const byName = await request(port, jar, 'GET', '/api/products?q=brake');
        assert.equal((byName.body.items as Rec[]).length, 2, 'matches product name/category');

        const byIdentifier = await request(port, jar, 'GET', '/api/products?q=BJP-12345');
        assert.equal((byIdentifier.body.items as Rec[]).length, 1, 'matches OEM identifier');
        assert.equal(((byIdentifier.body.items as Rec[])[0] as Rec).sku, 'BP-BOX-150');

        const byBrand = await request(port, jar, 'GET', '/api/products?q=brembo');
        assert.equal((byBrand.body.items as Rec[]).length, 1, 'matches brand name');

        const byCategory = await request(port, jar, 'GET', '/api/products?q=engine');
        assert.equal((byCategory.body.items as Rec[]).length, 1, 'matches category name');
      } finally {
        await close();
      }
    });

    test('product search filters by status, category and brand', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const categoryRes = await request(port, jar, 'GET', `/api/products?categoryId=${categories[0]!.id}`);
        assert.equal((categoryRes.body.items as Rec[]).length, 1);

        const brandRes = await request(port, jar, 'GET', `/api/products?brandId=${brands[0]!.id}`);
        assert.equal((brandRes.body.items as Rec[]).length, 1);

        const statusRes = await request(port, jar, 'GET', '/api/products?status=INACTIVE');
        assert.equal((statusRes.body.items as Rec[]).length, 0);
      } finally {
        await close();
      }
    });

    test('compatibility search: products compatible with a variant/model/make', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const byVariant = await request(port, jar, 'GET', `/api/products?variantId=${variants[3]!.id}`);
        assert.equal((byVariant.body.items as Rec[]).length, 2);

        const byModel = await request(port, jar, 'GET', `/api/products?modelId=${models[0]!.id}`);
        assert.equal((byModel.body.items as Rec[]).length, 1);

        const byMake = await request(port, jar, 'GET', `/api/products?makeId=${makes[1]!.id}`);
        assert.equal((byMake.body.items as Rec[]).length, 2);
      } finally {
        await close();
      }
    });

    test('product list paginates and sorts', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const page1 = await request(port, jar, 'GET', '/api/products?page=1&pageSize=2&sortBy=name&sortOrder=asc');
        assert.equal((page1.body.items as Rec[]).length, 2);
        assert.equal((page1.body.pagination as Rec).totalPages, 2);

        const page2 = await request(port, jar, 'GET', '/api/products?page=2&pageSize=2&sortBy=name&sortOrder=asc');
        assert.equal((page2.body.items as Rec[]).length, 1);
        assert.equal(((page2.body.items as Rec[])[0] as Rec).name, 'Drive Chain 150');
      } finally {
        await close();
      }
    });
  });

  describe('compatibility management', () => {
    test('compatibility can be added and removed standalone', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const added = await mutate(port, jar, 'POST', '/api/compatibility', {
          productId: products[1]!.id,
          variantId: variants[0]!.id,
        });
        assert.equal(added.status, 201);
        assert.ok(auditRecords.some((a) => a.action === 'COMPATIBILITY_ADDED'));

        const removed = await mutate(port, jar, 'DELETE', `/api/compatibility/${(added.body.compatibility as Rec).id}`);
        assert.equal(removed.status, 204);
        assert.ok(auditRecords.some((a) => a.action === 'COMPATIBILITY_REMOVED'));
      } finally {
        await close();
      }
    });

    test('duplicate compatibility is rejected', async () => {
      const { port, close } = await startServer();
      try {
        const jar = adminJar();
        const res = await mutate(port, jar, 'POST', '/api/compatibility', {
          productId: products[0]!.id,
          variantId: variants[1]!.id,
        });
        assert.equal(res.status, 409);
        assert.equal((res.body.error as Rec).code, 'DUPLICATE_COMPATIBILITY');
      } finally {
        await close();
      }
    });

    test('reverse lookup lists compatibility for a product', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        const res = await request(port, jar, 'GET', `/api/compatibility/products/${products[0]!.id}`);
        assert.equal(res.status, 200);
        assert.equal((res.body.items as Rec[]).length, 2);
      } finally {
        await close();
      }
    });
  });

  describe('authorization', () => {
    test('assistant can read/search catalog but not mutate it', async () => {
      const { port, close } = await startServer();
      try {
        const jar = assistantJar();
        for (const path of ['/api/products', '/api/categories', '/api/brands', '/api/motorcycles/makes', '/api/motorcycles/models', '/api/motorcycles/variants']) {
          const read = await request(port, jar, 'GET', path);
          assert.equal(read.status, 200, `${path} readable by assistant`);
        }

        const create = await mutate(port, jar, 'POST', '/api/products', {
          sku: 'FORBIDDEN-1',
          name: 'Nope',
          categoryId: categories[0]!.id,
          retailPrice: 1,
          wholesalePrice: 1,
        });
        assert.equal(create.status, 403);
        assert.equal((create.body.error as Rec).code, 'FORBIDDEN');

        const catCreate = await mutate(port, jar, 'POST', '/api/categories', { name: 'Nope' });
        assert.equal(catCreate.status, 403);

        const compatAdd = await mutate(port, jar, 'POST', '/api/compatibility', {
          productId: products[0]!.id,
          variantId: variants[0]!.id,
        });
        assert.equal(compatAdd.status, 403);
      } finally {
        await close();
      }
    });

    test('unauthenticated requests are rejected with 401', async () => {
      const { port, close } = await startServer();
      try {
        const jar = new CookieJar();
        const res = await request(port, jar, 'GET', '/api/products');
        assert.equal(res.status, 401);
        assert.equal((res.body.error as Rec).code, 'AUTHENTICATION_REQUIRED');
      } finally {
        await close();
      }
    });
  });
});