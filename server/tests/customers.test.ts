// Stage 9 — customer service tests.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '10';

import http from 'node:http';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const ASSISTANT_ID = 'assistant-1';
const CUSTOMER_ID = 'cust-1';

interface CustomerRec {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  type: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

let customers: Record<string, CustomerRec> = [];
let custIdCounter = 1;
const auditRecords: Array<Record<string, unknown>> = [];

const db = {
  user: {
    findUnique: mock.fn(async (args: { where: { id?: string } }) => {
      if (args.where?.id === ADMIN_ID) return { id: ADMIN_ID, email: 'admin@test', fullName: 'Admin', role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      if (args.where?.id === ASSISTANT_ID) return { id: ASSISTANT_ID, email: 'assistant@test', fullName: 'Assistant', role: 'ASSISTANT', status: 'ACTIVE', tokenVersion: 0, lastLoginAt: null };
      return null;
    }),
    update: mock.fn(async () => ({})),
  },
  customer: {
    findUnique: mock.fn(async (args: { where: { id: string }; include?: Record<string, unknown> }) => {
      return customers[args.where.id] ?? null;
    }),
    create: mock.fn(async (args: { data: Omit<CustomerRec, 'id' | 'createdAt' | 'updatedAt'>; select?: Record<string, unknown> }) => {
      const id = `cust-${custIdCounter++}`;
      const rec: CustomerRec = { id, ...args.data, createdAt: new Date(), updatedAt: new Date() };
      customers[id] = rec;
      return rec;
    }),
    update: mock.fn(async (args: { where: { id: string }; data: Partial<CustomerRec>; select?: Record<string, unknown> }) => {
      const existing = customers[args.where.id];
      if (!existing) return null;
      const updated = { ...existing, ...args.data, updatedAt: new Date() };
      customers[args.where.id] = updated;
      return updated;
    }),
    count: mock.fn(async (args?: { where?: Record<string, unknown> }) => {
      return Object.values(customers).length;
    }),
    findMany: mock.fn(async (args?: { where?: Record<string, unknown>; skip?: number; take?: number; select?: Record<string, unknown> }) => {
      const items = Object.values(customers);
      return items.slice(args?.skip ?? 0, (args?.skip ?? 0) + (args?.take ?? 25));
    }),
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

function assistantJar(): CookieJar {
  const jar = new CookieJar();
  jar.cookies.set('makire_session', signSessionToken(ASSISTANT_ID, 0));
  return jar;
}

beforeEach(() => {
  for (const fn of [db.user.findUnique, db.user.update, db.customer.findUnique, db.customer.create, db.customer.update, db.customer.count, db.customer.findMany, db.auditLog.create]) {
    fn.mock.resetCalls();
  }
  customers = {};
  custIdCounter = 1;
  auditRecords.length = 0;
  customers[CUSTOMER_ID] = {
    id: CUSTOMER_ID, name: 'John Doe', phone: '+255700000000', email: 'john@test.com',
    address: 'Dar es Salaam', notes: null, type: 'RETAIL', status: 'ACTIVE',
    createdAt: new Date(), updatedAt: new Date(),
  };
});

afterEach(() => { mock.reset(); });

describe('customers', () => {
  test('createCustomer creates a customer and audits', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/customers', { name: 'New Customer' }, csrf);
      assert.equal(res.status, 201);
      const body = res.body as { customer: CustomerRec };
      assert.equal(body.customer.name, 'New Customer');
      assert.equal(body.customer.type, 'RETAIL');
      assert.ok(auditRecords.some((a) => a.action === 'CUSTOMER_CREATED'));
    } finally { await close(); }
  });

  test('createCustomer rejects missing name', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/customers', {}, csrf);
      assert.equal(res.status, 400);
      assert.equal((res.body.error as { code: string }).code, 'INVALID_REQUEST');
    } finally { await close(); }
  });

  test('updateCustomer updates fields and audits', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PATCH', `/api/customers/${CUSTOMER_ID}`, { name: 'Jane Doe' }, csrf);
      assert.equal(res.status, 200);
      assert.equal((res.body as { customer: CustomerRec }).customer.name, 'Jane Doe');
      assert.ok(auditRecords.some((a) => a.action === 'CUSTOMER_UPDATED'));
    } finally { await close(); }
  });

  test('updateCustomer returns 404 for non-existent customer', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PATCH', '/api/customers/nonexistent', { name: 'X' }, csrf);
      assert.equal(res.status, 404);
    } finally { await close(); }
  });

  test('setCustomerStatus activates and deactivates a customer', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const deactivate = await request(port, jar, 'PATCH', `/api/customers/${CUSTOMER_ID}/status`, { status: 'INACTIVE' }, csrf);
      assert.equal(deactivate.status, 200);
      assert.equal((deactivate.body as { customer: CustomerRec }).customer.status, 'INACTIVE');
      assert.ok(auditRecords.some((a) => a.action === 'CUSTOMER_DEACTIVATED'));
    } finally { await close(); }
  });

  test('setCustomerStatus is a no-op when status already matches', async () => {
    const { port, close } = await startServer();
    try {
      const jar = adminJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'PATCH', `/api/customers/${CUSTOMER_ID}/status`, { status: 'ACTIVE' }, csrf);
      assert.equal(res.status, 200);
    } finally { await close(); }
  });

  test('listCustomers returns paginated results', async () => {
    const { port, close } = await startServer();
    try {
      const jar = assistantJar();
      const res = await request(port, jar, 'GET', '/api/customers?pageSize=10');
      assert.equal(res.status, 200);
      const body = res.body as { items: CustomerRec[]; pagination: { totalItems: number } };
      assert.ok(body.items.length >= 1);
      assert.ok(body.pagination.totalItems >= 1);
    } finally { await close(); }
  });

  test('getCustomer returns 404 for non-existent customer', async () => {
    const { port, close } = await startServer();
    try {
      const jar = assistantJar();
      const res = await request(port, jar, 'GET', '/api/customers/nonexistent');
      assert.equal(res.status, 404);
    } finally { await close(); }
  });

  test('unauthenticated user cannot create customer', async () => {
    const { port, close } = await startServer();
    try {
      const jar = new CookieJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/customers', { name: 'Test' }, csrf);
      assert.equal(res.status, 401);
    } finally { await close(); }
  });

  test('assistant cannot create customer (admin only)', async () => {
    const { port, close } = await startServer();
    try {
      const jar = assistantJar();
      const csrf = await getCsrf(port, jar);
      const res = await request(port, jar, 'POST', '/api/customers', { name: 'Test' }, csrf);
      assert.equal(res.status, 403);
    } finally { await close(); }
  });
});
