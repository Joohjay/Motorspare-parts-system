// Stage 8 — purchase returns unit verification.
//
// Runs against the real Express app (createApp) with Prisma replaced by an
// in-memory mock via the lib/prisma test seam (globalThis.__MAKIRE_PRISMA__).
// Covers returnable-quantity caps, supplier-credit clamping, inventory
// movement direction, refund settlement rules, cancel/reversal behaviour and
// the ADMIN/ASSISTANT authorization boundary. Live PostgreSQL concurrency
// guarantees are verified in tests/integration/purchaseReturns.integration.test.ts.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';

import http from 'node:http';

import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';

import type { AddressInfo } from 'node:net';

const ADMIN_ID = 'admin-1';
const ASSISTANT_ID = 'assistant-1';

type Rec = Record<string, unknown>;

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

let users: Record<string, Rec> = {};
let suppliers: Rec[] = [];
let purchases: Rec[] = [];
let purchaseItems: Rec[] = [];
let purchaseReturns: Rec[] = [];
let purchaseReturnItems: Rec[] = [];
let products: Rec[] = [];
let inventories: Rec[] = [];
let inventoryTransactions: Rec[] = [];
let supplierCreditAccounts: Rec[] = [];
let notifications: Rec[] = [];
let documentSequences: Rec[] = [];
const auditRecords: unknown[] = [];

function seedFixtures(): void {
  users = {
    [ADMIN_ID]: {
      id: ADMIN_ID,
      email: `${ADMIN_ID}@makire.test`,
      fullName: 'System Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: '',
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
    [ASSISTANT_ID]: {
      id: ASSISTANT_ID,
      email: `${ASSISTANT_ID}@makire.test`,
      fullName: 'Shop Assistant',
      role: 'ASSISTANT',
      status: 'ACTIVE',
      passwordHash: '',
      lastLoginAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    },
  };
  suppliers = [
    { id: 'sup-1', name: 'Hardy Enterprises', phone: null, email: null, address: null, notes: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  products = [
    { id: 'prod-1', sku: 'P-1', name: 'Brake Pad', minimumStock: 3, reorderLevel: 2, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'prod-2', sku: 'P-2', name: 'Chain', minimumStock: 3, reorderLevel: 2, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  inventories = [
    { id: 'inv-1', productId: 'prod-1', quantityOnHand: 50, quantityReserved: 0, weightedAverageCost: 60, updatedAt: new Date() },
    { id: 'inv-2', productId: 'prod-2', quantityOnHand: 30, quantityReserved: 0, weightedAverageCost: 120, updatedAt: new Date() },
  ];
  purchases = [
    { id: 'purch-1', purchaseNumber: 'PURCHASE-000001', purchaseOrderId: null, supplierId: 'sup-1', invoiceReference: 'INV-77', status: 'COMPLETED', paymentStatus: 'CREDIT', receivedAt: new Date(), totalAmount: 1080, notes: null, createdById: ADMIN_ID, createdAt: new Date(), updatedAt: new Date() },
    { id: 'purch-draft', purchaseNumber: 'PURCHASE-000002', purchaseOrderId: null, supplierId: 'sup-1', invoiceReference: null, status: 'DRAFT', paymentStatus: 'UNPAID', receivedAt: new Date(), totalAmount: 100, notes: null, createdById: ADMIN_ID, createdAt: new Date(), updatedAt: new Date() },
  ];
  purchaseItems = [
    { id: 'pi-1', purchaseId: 'purch-1', productId: 'prod-1', quantityOrdered: 10, quantityReceived: 10, quantityAccepted: 10, quantityDamaged: 0, quantityMissing: 0, unitCost: 60, lineTotal: 600, createdAt: new Date() },
    { id: 'pi-2', purchaseId: 'purch-1', productId: 'prod-2', quantityOrdered: 4, quantityReceived: 4, quantityAccepted: 4, quantityDamaged: 0, quantityMissing: 0, unitCost: 120, lineTotal: 480, createdAt: new Date() },
  ];
  purchaseReturns = [];
  purchaseReturnItems = [];
  inventoryTransactions = [];
  supplierCreditAccounts = [
    { id: 'scacc-1', supplierId: 'sup-1', outstandingBalance: 500, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  ];
  notifications = [];
  documentSequences = [
    { documentType: 'PURCHASE_RETURN', prefix: 'PURCHASE_RETURN', lastNumber: 0, padLength: 6 },
  ];
  auditRecords.length = 0;
}

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

function purchaseWithRelations(rec: Rec): Rec {
  return {
    ...rec,
    items: purchaseItems.filter((item) => item.purchaseId === rec.id),
    supplier: suppliers.find((s) => s.id === rec.supplierId) ?? null,
    createdBy: users[String(rec.createdById)] ?? null,
  };
}

function purchaseReturnWithRelations(rec: Rec): Rec {
  return {
    ...rec,
    items: purchaseReturnItems
      .filter((item) => item.purchaseReturnId === rec.id)
      .map((item) => ({ ...item, product: products.find((p) => p.id === item.productId) })),
    purchase: (() => {
      const purchase = purchases.find((p) => p.id === rec.purchaseId);
      return purchase
        ? { id: purchase.id, purchaseNumber: purchase.purchaseNumber, invoiceReference: purchase.invoiceReference ?? null, status: purchase.status }
        : null;
    })(),
    supplier: suppliers.find((s) => s.id === rec.supplierId) ?? null,
    createdBy: users[String(rec.createdById)] ?? null,
  };
}

const db = {
  user: {
    findUnique: mock.fn((args: { where: { id?: string } }) =>
      Promise.resolve(args.where.id ? users[args.where.id] ?? null : null)),
    findMany: mock.fn(() => Promise.resolve(Object.values(users).filter((u) => u.status === 'ACTIVE'))),
  },
  product: {
    findUnique: mock.fn((args: { where: { id: string } }) =>
      Promise.resolve(products.find((p) => p.id === args.where.id) ?? null)),
    findMany: mock.fn((args?: { where?: { id?: { in: string[] } } }) => {
      const ids = args?.where?.id?.in;
      return Promise.resolve(ids ? products.filter((p) => ids.includes(String(p.id))) : products);
    }),
  },
  purchase: {
    findUniqueOrThrow: mock.fn((args: { where: { id: string } }) => {
      const rec = purchases.find((p) => p.id === args.where.id);
      return rec ? Promise.resolve(purchaseWithRelations(rec)) : Promise.reject(new Error('purchase not found'));
    }),
  },
  purchaseReturn: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = {
        id: nextId('pret'),
        status: 'COMPLETED',
        returnDate: new Date(),
        creditedAmount: 0,
        refundMethod: null,
        refundReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...args.data,
      };
      purchaseReturns.push(rec);
      return Promise.resolve(rec);
    }),
    findUnique: mock.fn((args: { where: { id?: string; returnNumber?: string } }) => {
      const rec = args.where.id
        ? purchaseReturns.find((r) => r.id === args.where.id)
        : purchaseReturns.find((r) => r.returnNumber === args.where.returnNumber);
      return Promise.resolve(rec ? purchaseReturnWithRelations(rec) : null);
    }),
    findUniqueOrThrow: mock.fn((args: { where: { id?: string } }) => {
      const rec = purchaseReturns.find((r) => r.id === args.where.id);
      if (!rec) return Promise.reject(new Error('purchase return not found'));
      return Promise.resolve(purchaseReturnWithRelations(rec));
    }),
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const rec = purchaseReturns.find((r) => r.id === args.where.id);
      if (!rec) return Promise.reject(new Error('purchase return not found'));
      Object.assign(rec, args.data);
      return Promise.resolve(rec);
    }),
    findMany: mock.fn(() => Promise.resolve(purchaseReturns.map(purchaseReturnWithRelations))),
    count: mock.fn(() => Promise.resolve(purchaseReturns.length)),
  },
  purchaseReturnItem: {
    create: mock.fn((args: { data: Rec }) => {
      const rec: Rec = { id: nextId('pritem'), ...args.data };
      purchaseReturnItems.push(rec);
      return Promise.resolve(rec);
    }),
    groupBy: mock.fn((args: { where: { purchaseItemId: { in: string[] }; purchaseReturn: { status: string } }; _sum: { quantityReturned: boolean } }) => {
      const ids = args.where.purchaseItemId.in;
      const completedIds = new Set(purchaseReturns.filter((r) => r.status === 'COMPLETED').map((r) => r.id));
      const rows = purchaseReturnItems.filter(
        (ri) => ids.includes(String(ri.purchaseItemId)) && completedIds.has(String(ri.purchaseReturnId)),
      );
      const grouped = new Map<string, number>();
      for (const row of rows) {
        grouped.set(String(row.purchaseItemId), (grouped.get(String(row.purchaseItemId)) ?? 0) + Number(row.quantityReturned));
      }
      return Promise.resolve([...grouped.entries()].map(([purchaseItemId, qty]) => ({ purchaseItemId, _sum: { quantityReturned: qty } })));
    }),
  },
  supplierCreditAccount: {
    update: mock.fn((args: { where: { id: string }; data: Rec }) => {
      const rec = supplierCreditAccounts.find((a) => a.id === args.where.id);
      if (!rec) return Promise.reject(new Error('supplier credit account not found'));
      Object.assign(rec, args.data);
      return Promise.resolve(rec);
    }),
    aggregate: mock.fn(() => Promise.resolve({ _count: { _all: 0 }, _sum: { outstandingBalance: null } })),
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
  notification: {
    findFirst: mock.fn((args: { where: { userId: string; type: string; readAt: null } }) =>
      Promise.resolve(
        notifications.find(
          (n) => n.userId === args.where.userId && n.type === args.where.type && n.readAt === null,
        ) ?? null,
      )),
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
  $transaction: mock.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      const tables = [
        suppliers, purchases, purchaseItems, purchaseReturns, purchaseReturnItems,
        products, inventories, inventoryTransactions, supplierCreditAccounts,
        notifications, documentSequences,
      ];
      const snapshot = tables.map((table) => table.map((row) => ({ ...row })));
      const rollback = () => {
        tables.forEach((table, index) => {
          table.length = 0;
          table.push(...snapshot[index]);
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

    if (sql.includes('"purchases"')) {
      const purchaseId = String(values[0] ?? '');
      const purchase = purchases.find((p) => p.id === purchaseId);
      return Promise.resolve(purchase ? [{ id: purchase.id }] : []);
    }

    if (sql.includes('"purchase_returns"')) {
      const returnId = String(values[0] ?? '');
      const record = purchaseReturns.find((r) => r.id === returnId);
      return Promise.resolve(record ? [{ id: record.id }] : []);
    }

    if (sql.includes('supplier_credit_accounts')) {
      const supplierId = String(values[0] ?? '');
      const account = supplierCreditAccounts.find((a) => a.supplierId === supplierId);
      if (!account) return Promise.resolve([]);
      return Promise.resolve([{ id: account.id, status: account.status, outstandingBalance: account.outstandingBalance }]);
    }

    if (sql.includes('inventories')) {
      const productId = String(values[0] ?? '');
      let inv = inventories.find((i) => i.productId === productId);
      if (sql.includes('ON CONFLICT')) {
        if (inv) return Promise.resolve([]);
        inv = { id: nextId('inv'), productId, quantityOnHand: 0, quantityReserved: 0, weightedAverageCost: 0, updatedAt: new Date() };
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

function createBody(overrides: Rec = {}): Rec {
  return {
    items: [{ purchaseItemId: 'pi-1', quantity: 2 }],
    reason: 'Defective batch returned to supplier',
    settlement: 'SUPPLIER_CREDIT',
    ...overrides,
  };
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

describe('purchase returns — creation', () => {
  test('creates a completed return, deducts stock at WAC and reduces supplier credit', async () => {
    server = await startServer();
    // Start just above the low-stock threshold so the return triggers alerts.
    const inv1Seed = inventories.find((i) => i.productId === 'prod-1');
    inv1Seed!.quantityOnHand = 5;
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [
        { purchaseItemId: 'pi-1', quantity: 3 },
        { purchaseItemId: 'pi-2', quantity: 1 },
      ],
    }));
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const ret = res.body.return as Rec;
    assert.equal(ret.returnNumber, 'PURCHASE_RETURN-000001');
    assert.equal(ret.totalAmount, '300.00'); // 3x60 + 1x120 at frozen costs
    assert.equal(ret.creditedAmount, '300.00'); // credit balance 500 covers it
    assert.equal(ret.refundDue, '0.00');

    const inv1 = inventories.find((i) => i.productId === 'prod-1');
    assert.equal(inv1?.quantityOnHand, 2); // 5 - 3

    const txn = inventoryTransactions.find((t) => t.type === 'PURCHASE_RETURN' && t.productId === 'prod-1');
    assert.ok(txn, 'ledger row written for returned stock');
    assert.equal(Number(txn?.unitCost), 60); // leaves at current WAC
    assert.equal(Number(txn?.balanceAfter), 2);

    const account = supplierCreditAccounts[0];
    assert.equal(Number(account.outstandingBalance), 200); // 500 - 300

    assert.ok(auditRecords.some((record) => (record as Rec).action === 'PURCHASE_RETURN_CREATED'));

    // Low-stock notifications fired for both products (idempotent per user).
    assert.ok(notifications.length >= 1);
  });

  test('credit settlement clamps to the outstanding balance with refundDue remainder', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [{ purchaseItemId: 'pi-1', quantity: 10 }],
    }));
    assert.equal(res.status, 201);
    const ret = res.body.return as Rec;
    assert.equal(ret.totalAmount, '600.00'); // 10 x frozen 60
    assert.equal(ret.creditedAmount, '500.00'); // balance only
    assert.equal(ret.refundDue, '100.00');

    assert.equal(Number(supplierCreditAccounts[0].outstandingBalance), 0);
  });

  test('rejects returns beyond the accepted quantity and rolls everything back', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [{ purchaseItemId: 'pi-1', quantity: 11 }],
    }));
    assert.equal(res.status, 409);
    assert.equal((res.body.error as Rec).code, 'RETURN_EXCEEDS_RETURNABLE');

    assert.equal(inventories.find((i) => i.productId === 'prod-1')?.quantityOnHand, 50);
    assert.equal(purchaseReturns.length, 0);
    assert.equal(documentSequences[0].lastNumber, 0, 'sequence untouched after rollback');
  });

  test('cumulative returns across documents are capped by remaining returnable qty', async () => {
    server = await startServer();
    const first = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [{ purchaseItemId: 'pi-1', quantity: 6 }],
    }));
    assert.equal(first.status, 201);

    const second = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [{ purchaseItemId: 'pi-1', quantity: 5 }],
    }));
    assert.equal(second.status, 409);
    assert.equal((second.body.error as Rec).code, 'RETURN_EXCEEDS_RETURNABLE');

    const okSecond = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [{ purchaseItemId: 'pi-1', quantity: 4 }],
    }));
    assert.equal(okSecond.status, 201);
    assert.equal(inventories.find((i) => i.productId === 'prod-1')?.quantityOnHand, 40);
  });

  test('items must belong to the target purchase', async () => {
    server = await startServer();
    purchaseItems.push({ id: 'pi-other', purchaseId: 'purch-draft', productId: 'prod-1', quantityOrdered: 5, quantityReceived: 5, quantityAccepted: 5, quantityDamaged: 0, quantityMissing: 0, unitCost: 60, lineTotal: 300, createdAt: new Date() });

    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [{ purchaseItemId: 'pi-other', quantity: 1 }],
    }));
    assert.equal(res.status, 400);
    assert.equal((res.body.error as Rec).code, 'INVALID_PURCHASE_ITEM');
  });

  test('draft purchases cannot be returned against', async () => {
    server = await startServer();
    purchaseItems.push({ id: 'pi-draft', purchaseId: 'purch-draft', productId: 'prod-1', quantityOrdered: 5, quantityReceived: 5, quantityAccepted: 5, quantityDamaged: 0, quantityMissing: 0, unitCost: 60, lineTotal: 300, createdAt: new Date() });

    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-draft/returns', createBody({
      items: [{ purchaseItemId: 'pi-draft', quantity: 1 }],
    }));
    assert.equal(res.status, 409);
    assert.equal((res.body.error as Rec).code, 'PURCHASE_NOT_ACTIVE');
  });

  test('REFUND settlement requires a refund method and records it', async () => {
    server = await startServer();

    const missing = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      settlement: 'REFUND',
    }));
    assert.equal(missing.status, 400);

    const ok = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      settlement: 'REFUND',
      refundMethod: 'MPESA',
      refundReference: 'TX-991',
    }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const ret = ok.body.return as Rec;
    assert.equal(ret.creditedAmount, '0.00');
    assert.equal(ret.refundDue, '120.00');

    assert.ok(auditRecords.some((record) => (record as Rec).action === 'SUPPLIER_REFUND_RECORDED'));
    assert.ok(!auditRecords.some((record) => (record as Rec).action === 'SUPPLIER_REFUND_RECORDED' && ((record as Rec).afterState as Rec)?.method === undefined));
    assert.equal(Number(supplierCreditAccounts[0].outstandingBalance), 500, 'credit balance untouched');
  });

  test('NONE settlement records the full amount as owed by the supplier', async () => {
    server = await startServer();
    const res = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      settlement: 'NONE',
    }));
    assert.equal(res.status, 201);
    const ret = res.body.return as Rec;
    assert.equal(ret.creditedAmount, '0.00');
    assert.equal(ret.refundDue, '120.00');
    assert.equal(Number(supplierCreditAccounts[0].outstandingBalance), 500);
  });
});

describe('purchase returns — authorization', () => {
  test('ASSISTANT cannot create or cancel but can view', async () => {
    server = await startServer();

    const deniedCreate = await mutate(server.port, assistantJar(), 'POST', '/api/purchases/purch-1/returns', createBody());
    assert.equal(deniedCreate.status, 403);

    const list = await request(server.port, assistantJar(), 'GET', '/api/purchase-returns');
    assert.equal(list.status, 200);

    const seeded = purchaseReturns.push({
      id: 'ret-seed',
      returnNumber: 'PURCHASE_RETURN-900001',
      purchaseId: 'purch-1',
      supplierId: 'sup-1',
      status: 'COMPLETED',
      reason: 'seed',
      returnDate: new Date(),
      totalAmount: 60,
      creditedAmount: 0,
      refundMethod: null,
      refundReference: null,
      createdById: ADMIN_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.ok(seeded);

    const detail = await request(server.port, assistantJar(), 'GET', '/api/purchase-returns/ret-seed');
    assert.equal(detail.status, 200);

    const deniedCancel = await mutate(server.port, assistantJar(), 'POST', '/api/purchase-returns/ret-seed/cancel');
    assert.equal(deniedCancel.status, 403);
  });
});

describe('purchase returns — cancellation', () => {
  test('cancelling restores stock at frozen cost and re-charges supplier credit', async () => {
    server = await startServer();
    const created = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody({
      items: [{ purchaseItemId: 'pi-1', quantity: 3 }],
    }));
    assert.equal(created.status, 201);
    const returnId = (created.body.return as Rec).id as string;

    const cancel = await mutate(server.port, adminJar(), 'POST', `/api/purchase-returns/${returnId}/cancel`);
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

    const inv = inventories.find((i) => i.productId === 'prod-1');
    assert.equal(inv?.quantityOnHand, 50, 'stock restored');

    const reversalTxn = inventoryTransactions.find((t) => t.type === 'ADJUSTMENT' && t.referenceId === returnId);
    assert.ok(reversalTxn, 'restock ledger row references the return');
    assert.equal(Number(reversalTxn?.unitCost), 60, 'restocked at frozen cost');
    // WAC recomputed: (47*60 + 3*60)/50 = 60 — unchanged because equal costs.
    assert.equal(Number(inv?.weightedAverageCost), 60);

    assert.equal(Number(supplierCreditAccounts[0].outstandingBalance), 500, 'credit re-charged in full');

    assert.ok(auditRecords.some((record) => (record as Rec).action === 'PURCHASE_RETURN_CANCELLED'));
  });

  test('double cancellation is rejected', async () => {
    server = await startServer();
    const created = await mutate(server.port, adminJar(), 'POST', '/api/purchases/purch-1/returns', createBody());
    const returnId = (created.body.return as Rec).id as string;

    const first = await mutate(server.port, adminJar(), 'POST', `/api/purchase-returns/${returnId}/cancel`);
    assert.equal(first.status, 200);

    const second = await mutate(server.port, adminJar(), 'POST', `/api/purchase-returns/${returnId}/cancel`);
    assert.equal(second.status, 409);
    assert.equal((second.body.error as Rec).code, 'PURCHASE_RETURN_NOT_ACTIVE');
  });
});
