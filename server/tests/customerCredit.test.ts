// Stage 9 — customer credit service tests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import http from 'node:http';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const CUSTOMER_ID = 'cust-1';

interface CreditAccountRec {
  id: string;
  customerId: string;
  creditLimit: unknown;
  outstandingBalance: unknown;
  status: string;
  createdAt: Date;
}

interface CreditPaymentRec {
  id: string;
  accountId: string;
  amount: unknown;
  paymentMethod: string;
  reference: string | null;
  paidAt: Date;
  createdById: string;
}

let accounts: Record<string, CreditAccountRec> = {};
let payments: CreditPaymentRec[] = [];
let payIdCounter = 1;
const auditRecords: Array<Record<string, unknown>> = [];

function createTx() {
  return {
    $queryRaw: mock.fn(async () => {
      const acc = Object.values(accounts)[0];
      return acc ? [{ id: acc.id }] : [];
    }),
    customerCreditAccount: {
      findUniqueOrThrow: mock.fn(async () => Object.values(accounts)[0] ?? null),
      update: mock.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const acc = accounts[args.where.id];
        if (!acc) return null;
        Object.assign(acc, args.data);
        return acc;
      }),
    },
  };
}

const db = {
  user: {
    findUnique: mock.fn(async (args: { where: { id?: string } }) => {
      if (args.where?.id === ADMIN_ID) return { id: ADMIN_ID, email: 'admin@test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      return null;
    }),
    update: mock.fn(async () => ({})),
  },
  customer: {
    findUnique: mock.fn(async (args: { where: { id: string } }) => {
      if (args.where.id === CUSTOMER_ID) return { id: CUSTOMER_ID, name: 'John', status: 'ACTIVE' };
      return null;
    }),
  },
  customerCreditAccount: {
    findUnique: mock.fn(async (args: { where: { customerId?: string } }) => {
      return Object.values(accounts).find((a) => a.customerId === args.where.customerId) ?? null;
    }),
    create: mock.fn(async (args: { data: Omit<CreditAccountRec, 'id' | 'createdAt'> }) => {
      const id = `cca-${Object.keys(accounts).length + 1}`;
      const rec: CreditAccountRec = { id, ...args.data, createdAt: new Date() };
      accounts[id] = rec;
      return rec;
    }),
    findMany: mock.fn(async () => Object.values(accounts)),
    aggregate: mock.fn(async () => ({
      _count: { _all: Object.keys(accounts).length },
      _sum: { outstandingBalance: Object.values(accounts).reduce((s, a) => s + Number(a.outstandingBalance), 0), creditLimit: Object.values(accounts).reduce((s, a) => s + Number(a.creditLimit), 0) },
    })),
  },
  customerCreditPayment: {
    count: mock.fn(async () => payments.length),
    findMany: mock.fn(async (args?: { skip?: number; take?: number }) => {
      return payments.slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? 25));
    }),
  },
  payment: {
    findMany: mock.fn(async () => []),
  },
  auditLog: {
    create: mock.fn(async (args: { data: Record<string, unknown> }) => {
      auditRecords.push(args.data);
      return args.data;
    }),
  },
  $queryRaw: mock.fn(async () => []),
  $transaction: mock.fn(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
    const tx = createTx();
    return fn(tx as unknown as Record<string, unknown>);
  }),
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
    db.customer.findUnique, db.customerCreditAccount.findUnique, db.customerCreditAccount.create,
    db.customerCreditAccount.findMany, db.customerCreditAccount.aggregate,
    db.customerCreditPayment.count, db.customerCreditPayment.findMany,
    db.payment.findMany, db.auditLog.create, db.$transaction, db.$queryRaw,
  ]) {
    fn.mock.resetCalls();
  }
  accounts = {};
  payments = [];
  payIdCounter = 1;
  auditRecords.length = 0;
});

afterEach(() => { mock.reset(); });

describe('customer credit accounts', () => {
  test('openCreditAccount creates a new account and audits', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', `/api/customers/${CUSTOMER_ID}/credit-account`, undefined, csrf);
      assert.equal(res.status, 201);
      const body = res.body as { creditAccount: CreditAccountRec };
      assert.equal(body.creditAccount.customerId, CUSTOMER_ID);
      assert.equal(body.creditAccount.status, 'ACTIVE');
      assert.ok(auditRecords.some((a) => a.action === 'CUSTOMER_CREDIT_ACCOUNT_OPENED'));
    } finally { await close(); }
  });

  test('openCreditAccount rejects duplicate account', async () => {
    accounts['existing'] = {
      id: 'existing', customerId: CUSTOMER_ID, creditLimit: 0, outstandingBalance: 0, status: 'ACTIVE', createdAt: new Date(),
    };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', `/api/customers/${CUSTOMER_ID}/credit-account`, undefined, csrf);
      assert.equal(res.status, 409);
    } finally { await close(); }
  });

  test('openCreditAccount returns 404 for non-existent customer', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/customers/bad-id/credit-account', undefined, csrf);
      assert.equal(res.status, 404);
    } finally { await close(); }
  });

  test('getCreditAccount returns account details with availableCredit', async () => {
    accounts['existing'] = {
      id: 'existing', customerId: CUSTOMER_ID, creditLimit: 500000, outstandingBalance: 200000, status: 'ACTIVE', createdAt: new Date(),
    };
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', `/api/customers/${CUSTOMER_ID}/credit-account`);
      assert.equal(res.status, 200);
      const body = res.body as { creditAccount: CreditAccountRec & { availableCredit: string } };
      assert.equal(body.creditAccount.creditLimit, '500000.00');
      assert.equal(body.creditAccount.availableCredit, '300000.00');
    } finally { await close(); }
  });

  test('getCreditAccount returns 404 when no account exists', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const res = await request(port, jar, 'GET', `/api/customers/${CUSTOMER_ID}/credit-account`);
      assert.equal(res.status, 404);
    } finally { await close(); }
  });
});
