// Stage 9 — supplier credit service tests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import http from 'node:http';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const SUPPLIER_ID = 'supp-1';

interface SupplierRec {
  id: string;
  name: string;
  status: string;
}

interface CreditAccountRec {
  id: string;
  supplierId: string;
  outstandingBalance: unknown;
  status: string;
  createdAt: Date;
}

interface SupplierPaymentRec {
  id: string;
  accountId: string;
  purchaseId: string | null;
  amount: unknown;
  paymentMethod: string;
  reference: string | null;
  paidAt: Date;
  createdById: string;
}

let suppliers: Record<string, SupplierRec> = {};
let accounts: Record<string, CreditAccountRec> = {};
let payments: SupplierPaymentRec[] = [];
let payIdCounter = 1;
const auditRecords: Array<Record<string, unknown>> = [];

const db = {
  user: {
    findUnique: mock.fn(async (args: { where: { id?: string } }) => {
      if (args.where?.id === ADMIN_ID) return { id: ADMIN_ID, email: 'admin@test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      return null;
    }),
    update: mock.fn(async () => ({})),
  },
  supplier: {
    findUnique: mock.fn(async (args: { where: { id: string } }) => {
      return suppliers[args.where.id] ?? null;
    }),
  },
  supplierCreditAccount: {
    findUnique: mock.fn(async (args: { where: { supplierId?: string } }) => {
      return Object.values(accounts).find((a) => a.supplierId === args.where?.supplierId) ?? null;
    }),
    findUniqueOrThrow: mock.fn(async (args: { where: { supplierId?: string } }) => {
      const acc = Object.values(accounts).find((a) => a.supplierId === args.where?.supplierId);
      if (!acc) throw new Error('Not found');
      return acc;
    }),
    create: mock.fn(async (args: { data: Omit<CreditAccountRec, 'id' | 'createdAt'> }) => {
      const id = `sca-${Object.keys(accounts).length + 1}`;
      const rec: CreditAccountRec = { id, ...args.data, createdAt: new Date() };
      accounts[id] = rec;
      return rec;
    }),
    update: mock.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const acc = accounts[args.where.id];
      if (!acc) return null;
      Object.assign(acc, args.data);
      return acc;
    }),
  },
  supplierCreditPayment: {
    count: mock.fn(async () => payments.length),
    findMany: mock.fn(async (args?: { skip?: number; take?: number }) => {
      return payments.slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? 25));
    }),
    create: mock.fn(async (args: { data: Omit<SupplierPaymentRec, 'id'> }) => {
      const id = `sp-${payIdCounter++}`;
      const rec: SupplierPaymentRec = { id, ...args.data };
      payments.push(rec);
      return rec;
    }),
  },
  purchase: {
    findUnique: mock.fn(async () => null),
    update: mock.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      return args.data;
    }),
  },
  auditLog: {
    create: mock.fn(async (args: { data: Record<string, unknown> }) => {
      auditRecords.push(args.data);
      return args.data;
    }),
  },
  $queryRaw: mock.fn(async (args: TemplateStringsArray, ...values: unknown[]) => {
    const supplierId = values[0];
    const acc = Object.values(accounts).find((a) => a.supplierId === supplierId);
    return acc ? [{ id: acc.id, outstandingBalance: acc.outstandingBalance }] : [];
  }),
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
    db.supplier.findUnique, db.supplierCreditAccount.findUnique, db.supplierCreditAccount.findUniqueOrThrow,
    db.supplierCreditAccount.create, db.supplierCreditAccount.update,
    db.supplierCreditPayment.count, db.supplierCreditPayment.findMany, db.supplierCreditPayment.create,
    db.purchase.findUnique, db.purchase.update,
    db.auditLog.create, db.$transaction, db.$queryRaw,
  ]) {
    fn.mock.resetCalls();
  }
  suppliers = { [SUPPLIER_ID]: { id: SUPPLIER_ID, name: 'Parts Co', status: 'ACTIVE' } };
  accounts = {};
  payments = [];
  payIdCounter = 1;
  auditRecords.length = 0;
});

afterEach(() => { mock.reset(); });

describe('supplier credit accounts', () => {
  test('openCreditAccount creates an account and audits', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', `/api/supplier-credit/${SUPPLIER_ID}/account`, undefined, csrf);
      assert.equal(res.status, 201);
      const body = res.body as { creditAccount: CreditAccountRec };
      assert.equal(body.creditAccount.supplierId, SUPPLIER_ID);
      assert.equal(body.creditAccount.status, 'ACTIVE');
      assert.ok(auditRecords.some((a) => a.action === 'SUPPLIER_CREDIT_ACCOUNT_OPENED'));
    } finally { await close(); }
  });

  test('openCreditAccount rejects duplicate', async () => {
    accounts['existing'] = {
      id: 'existing', supplierId: SUPPLIER_ID, outstandingBalance: 0, status: 'ACTIVE', createdAt: new Date(),
    };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', `/api/supplier-credit/${SUPPLIER_ID}/account`, undefined, csrf);
      assert.equal(res.status, 409);
    } finally { await close(); }
  });

  test('openCreditAccount returns 404 for non-existent supplier', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/supplier-credit/bad-id/account', undefined, csrf);
      assert.equal(res.status, 404);
    } finally { await close(); }
  });

  test('getCreditAccount returns account details', async () => {
    accounts['existing'] = {
      id: 'existing', supplierId: SUPPLIER_ID, outstandingBalance: 1000000, status: 'ACTIVE', createdAt: new Date(),
    };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', `/api/supplier-credit/${SUPPLIER_ID}`);
      assert.equal(res.status, 200);
      const body = res.body as { creditAccount: CreditAccountRec };
      assert.equal(body.creditAccount.outstandingBalance, 1000000);
    } finally { await close(); }
  });

  test('getCreditAccount returns 404 when no account exists', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', `/api/supplier-credit/${SUPPLIER_ID}`);
      assert.equal(res.status, 404);
    } finally { await close(); }
  });

  test('listCreditPayments returns paginated payments', async () => {
    accounts['existing'] = {
      id: 'existing', supplierId: SUPPLIER_ID, outstandingBalance: 500000, status: 'ACTIVE', createdAt: new Date(),
    };
    payments.push(
      { id: 'sp-1', accountId: 'existing', purchaseId: null, amount: 100000, paymentMethod: 'CASH', reference: null, paidAt: new Date(), createdById: ADMIN_ID },
    );
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', `/api/supplier-credit/${SUPPLIER_ID}/payments?pageSize=10`);
      assert.equal(res.status, 200);
      const body = res.body as { items: SupplierPaymentRec[]; pagination: { totalItems: number } };
      assert.equal(body.items.length, 1);
      assert.equal(body.pagination.totalItems, 1);
    } finally { await close(); }
  });
});
