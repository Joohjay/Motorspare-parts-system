// Stage 5 — inventory integration verification against REAL PostgreSQL.
//
// Runs the inventory service against a real database (makire_motorparts_test —
// a dedicated, disposable database so the development database is never
// touched). These tests verify the guarantees the in-memory mock cannot:
//   - stock mutation atomicity (row-lock serialization under real concurrency)
//   - reservation concurrency (reserved can never exceed available/on-hand)
//   - weighted-average costing persistence (exact DECIMAL values on disk)
//   - inventory ledger consistency (balanceAfter = running on-hand)
//
// Run with: npm run test:integration   (requires a running PostgreSQL)

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
import 'dotenv/config';

// Point the process at the dedicated test database BEFORE the app module graph
// loads (config/env and lib/prisma read DATABASE_URL at import time).
const devUrl = process.env.DATABASE_URL ?? '';
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  devUrl.replace(/\/[^/]+$/, '/makire_motorparts_test');
process.env.DATABASE_URL = TEST_DATABASE_URL;

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const [{ default: prisma }] = await Promise.all([import('../../src/lib/prisma.js')]);
const inventoryService = await import('../../src/services/inventoryService.js');

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let adminUserId = '';
let categoryId = '';
let brandId = '';
let productCounter = 0;

async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       "inventory_transactions", "stock_reservations", "inventories",
       "notifications", "audit_logs",
       "product_compatibilities", "product_identifiers", "products"
     RESTART IDENTITY CASCADE`,
  );
}

async function createProduct(overrides: { minimumStock?: number; reorderLevel?: number } = {}): Promise<string> {
  productCounter += 1;
  const p = await prisma.product.create({
    data: {
      sku: `INT-${process.pid}-${Date.now()}-${productCounter}`,
      name: `Integration Product ${productCounter}`,
      categoryId,
      brandId,
      retailPrice: 100,
      wholesalePrice: 80,
      minimumStock: overrides.minimumStock ?? 3,
      reorderLevel: overrides.reorderLevel ?? 2,
    },
  });
  return p.id;
}

before(async () => {
  await resetDb();
  const admin = await prisma.user.upsert({
    where: { email: 'integration-admin@makire.test' },
    update: { role: 'ADMIN', status: 'ACTIVE' },
    create: {
      email: 'integration-admin@makire.test',
      fullName: 'Integration Admin',
      passwordHash: 'not-used',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  adminUserId = admin.id;
  const cat = await prisma.category.upsert({
    where: { slug: 'integration' },
    update: {},
    create: { name: 'Integration', slug: 'integration' },
  });
  categoryId = cat.id;
  const brand = await prisma.brand.upsert({
    where: { name: 'IntegrationBrand' },
    update: {},
    create: { name: 'IntegrationBrand' },
  });
  brandId = brand.id;
});

beforeEach(async () => {
  await resetDb();
});

after(async () => {
  await resetDb();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Stock mutation atomicity
// ---------------------------------------------------------------------------

describe('stock mutation atomicity (real PostgreSQL)', () => {
  test('concurrent stock-out never drives on-hand negative (row lock serializes)', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 100, unitCost: 100, createdById: adminUserId });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        inventoryService.decreaseStock({ productId: pid, quantity: 20, createdById: adminUserId }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 5, 'exactly 5 of 6 concurrent stock-outs succeed (100 / 20)');
    assert.equal(rejected.length, 1, 'the remaining stock-out is rejected');
    const err = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
    assert.equal(err.code, 'INSUFFICIENT_STOCK');

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityOnHand, 0, 'on-hand is never negative');
    assert.ok(inv!.quantityOnHand >= 0);

    const rows = await prisma.inventoryTransaction.findMany({ where: { productId: pid }, orderBy: { createdAt: 'asc' } });
    assert.ok(rows.every((t) => t.balanceAfter >= 0), 'no ledger row records a negative balance');
    const net = rows.reduce((sum, t) => sum + t.quantity, 0);
    assert.equal(net, 0, 'ledger net movement matches final on-hand (100 in, 100 out)');
    assert.equal(rows.filter((t) => t.quantity < 0).length, 5, 'exactly five stock-out rows');
  });

  test('concurrent stock-in has no lost updates', async () => {
    const pid = await createProduct();
    await Promise.all(
      Array.from({ length: 6 }, () =>
        inventoryService.increaseStock({ productId: pid, quantity: 5, unitCost: 100, createdById: adminUserId }),
      ),
    );
    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityOnHand, 30, 'all six +5 updates are applied');
    const count = await prisma.inventoryTransaction.count({ where: { productId: pid } });
    assert.equal(count, 6, 'one ledger row per stock-in');
  });

  test('mixed concurrent in/out stays consistent and never negative', async () => {
    const pid = await createProduct();
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i += 1) {
      ops.push(inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 100, createdById: adminUserId }));
    }
    for (let i = 0; i < 6; i += 1) {
      ops.push(inventoryService.decreaseStock({ productId: pid, quantity: 5, createdById: adminUserId }));
    }
    const results = await Promise.allSettled(ops);
    const fulfilledOuts = results.filter((r, i) => i >= 4 && r.status === 'fulfilled').length;
    const rejectedOuts = results.filter((r, i) => i >= 4 && r.status === 'rejected');

    for (const r of rejectedOuts) {
      const reason = (r as PromiseRejectedResult).reason as { code?: string };
      assert.equal(reason.code, 'INSUFFICIENT_STOCK');
    }

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityOnHand, 40 - 5 * fulfilledOuts, 'on-hand equals in minus successful outs');

    const rows = await prisma.inventoryTransaction.findMany({ where: { productId: pid }, orderBy: { createdAt: 'asc' } });
    assert.ok(rows.every((t) => t.balanceAfter >= 0), 'no ledger row records a negative balance');
    const net = rows.reduce((sum, t) => sum + t.quantity, 0);
    assert.equal(net, inv!.quantityOnHand, 'ledger net equals final on-hand');
    assert.equal(rows[rows.length - 1]!.balanceAfter, inv!.quantityOnHand, 'last balanceAfter equals final on-hand');
  });
});

// ---------------------------------------------------------------------------
// Reservation concurrency
// ---------------------------------------------------------------------------

describe('reservation concurrency (real PostgreSQL)', () => {
  test('concurrent reservations never exceed available stock', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 100, createdById: adminUserId });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        inventoryService.reserve({ productId: pid, quantity: 3, createdById: adminUserId }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(fulfilled, 3, 'floor(10/3) = 3 reservations succeed');
    assert.equal(results.filter((r) => r.status === 'rejected').length, 2);
    for (const r of results) {
      if (r.status === 'rejected') {
        assert.equal((r.reason as { code?: string }).code, 'INSUFFICIENT_AVAILABLE_STOCK');
      }
    }

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityReserved, 9, 'reserved equals sum of accepted reservations');
    assert.equal(inv!.quantityOnHand, 10, 'on-hand unchanged by reservations');
    assert.ok(inv!.quantityReserved <= inv!.quantityOnHand, 'reserved never exceeds on-hand');
  });

  test('release returns capacity and stock can be re-reserved', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 100, createdById: adminUserId });
    const r1 = await inventoryService.reserve({ productId: pid, quantity: 6, createdById: adminUserId });

    let inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityReserved, 6);
    assert.equal(inv!.quantityOnHand - inv!.quantityReserved, 4);

    await inventoryService.releaseReservation({ reservationId: r1.reservation.id, createdById: adminUserId });
    inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityReserved, 0);

    const r2 = await inventoryService.reserve({ productId: pid, quantity: 8, createdById: adminUserId });
    assert.equal(r2.reservation.status, 'ACTIVE', 're-reserved capacity creates a fresh active reservation');
    inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityReserved, 8);
  });

  test('concurrent reserve and release keep the reserved column consistent with reservation rows', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 20, unitCost: 100, createdById: adminUserId });
    const initial = await inventoryService.reserve({ productId: pid, quantity: 10, createdById: adminUserId });

    await Promise.all([
      inventoryService.releaseReservation({ reservationId: initial.reservation.id, createdById: adminUserId }),
      inventoryService.reserve({ productId: pid, quantity: 5, createdById: adminUserId }),
      inventoryService.reserve({ productId: pid, quantity: 5, createdById: adminUserId }),
    ]);

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityReserved, 10, '10 released then 10 re-reserved');
    assert.ok(inv!.quantityReserved <= inv!.quantityOnHand);

    const active = await prisma.stockReservation.findMany({ where: { status: 'ACTIVE' } });
    const activeQty = active.reduce((sum, r) => sum + r.quantity, 0);
    assert.equal(activeQty, inv!.quantityReserved, 'sum of ACTIVE reservation rows equals reserved column');
  });
});

// ---------------------------------------------------------------------------
// Weighted-average costing persistence
// ---------------------------------------------------------------------------

describe('weighted-average costing persistence (real PostgreSQL)', () => {
  test('average cost is recomputed and persisted as exact DECIMAL', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 100, createdById: adminUserId });
    const res = await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 200, createdById: adminUserId });

    assert.equal(res.inventory.weightedAverageCost, '150.00');
    assert.equal(res.inventory.inventoryValue, '3000.00');

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.weightedAverageCost.toFixed(2), '150.00', 'weightedAverageCost persisted on disk');

    const rows = await prisma.inventoryTransaction.findMany({ where: { productId: pid }, orderBy: { createdAt: 'asc' } });
    assert.equal(rows[0]!.unitCost!.toFixed(2), '100.00', 'ledger freezes the receipt unit cost');
    assert.equal(rows[1]!.unitCost!.toFixed(2), '200.00');
  });

  test('Decimal precision with fractional unit costs', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 3, unitCost: 33.33, createdById: adminUserId });
    const res = await inventoryService.increaseStock({ productId: pid, quantity: 3, unitCost: 66.67, createdById: adminUserId });

    assert.equal(res.inventory.weightedAverageCost, '50.00', '(3*33.33 + 3*66.67) / 6 = 50.00');
    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.weightedAverageCost.toFixed(2), '50.00');
  });

  test('stock-out consumes at current average; cost resets after stock hits zero', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 100, createdById: adminUserId });
    await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 200, createdById: adminUserId });

    const out = await inventoryService.decreaseStock({ productId: pid, quantity: 5, createdById: adminUserId });
    assert.equal(out.inventory.weightedAverageCost, '150.00', 'cost unchanged by a stock-out');
    assert.equal(out.inventory.inventoryValue, '2250.00', 'value drops at the current average (15 x 150)');

    await inventoryService.decreaseStock({ productId: pid, quantity: 15, createdById: adminUserId });
    const empty = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(empty!.quantityOnHand, 0);

    const res = await inventoryService.increaseStock({ productId: pid, quantity: 5, unitCost: 300, createdById: adminUserId });
    assert.equal(res.inventory.weightedAverageCost, '300.00', 'average resets when restocked from zero');
  });
});

// ---------------------------------------------------------------------------
// Inventory ledger consistency
// ---------------------------------------------------------------------------

describe('inventory ledger consistency (real PostgreSQL)', () => {
  test('every movement writes an immutable row whose balanceAfter equals running on-hand', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 20, unitCost: 100, createdById: adminUserId });
    await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 150, createdById: adminUserId });
    await inventoryService.decreaseStock({ productId: pid, quantity: 8, createdById: adminUserId });
    await inventoryService.adjust({ productId: pid, quantity: -2, reason: 'damaged unit', type: 'DAMAGE', createdById: adminUserId });
    const res = await inventoryService.reserve({ productId: pid, quantity: 5, createdById: adminUserId });
    await inventoryService.releaseReservation({ reservationId: res.reservation.id, createdById: adminUserId });
    await inventoryService.adjust({ productId: pid, quantity: 3, reason: 'found in stocktake', createdById: adminUserId });

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    const rows = await prisma.inventoryTransaction.findMany({ where: { productId: pid }, orderBy: { createdAt: 'asc' } });

    let running = 0;
    for (const t of rows) {
      running += t.quantity;
      assert.equal(t.balanceAfter, running, 'balanceAfter must equal the running on-hand at every step');
    }
    assert.equal(inv!.quantityOnHand, running, 'final on-hand equals the last running balance');
    const netMovement = rows.filter((t) => t.quantity !== 0).reduce((sum, t) => sum + t.quantity, 0);
    assert.equal(netMovement, inv!.quantityOnHand, 'net signed movement equals final on-hand');

    const reservationRows = rows.filter((t) => t.type === 'RESERVATION' || t.type === 'RESERVATION_RELEASE');
    assert.equal(reservationRows.length, 2);
    assert.ok(reservationRows.every((t) => t.quantity === 0), 'reservation rows leave on-hand unchanged');
    assert.ok(reservationRows.every((t) => t.referenceId !== null), 'reservation rows link to the reservation');
  });

  test('failed mutation leaves ledger and stock unchanged', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 5, unitCost: 100, createdById: adminUserId });

    await assert.rejects(
      inventoryService.decreaseStock({ productId: pid, quantity: 6, createdById: adminUserId }),
      (err: unknown) => (err as { code?: string }).code === 'INSUFFICIENT_STOCK',
    );

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityOnHand, 5, 'stock unchanged after rejected mutation');
    const rows = await prisma.inventoryTransaction.findMany({ where: { productId: pid } });
    assert.equal(rows.length, 1, 'no spurious ledger row written');
  });

  test('adjustments are recorded with type, reason and balanceAfter', async () => {
    const pid = await createProduct();
    await inventoryService.increaseStock({ productId: pid, quantity: 10, unitCost: 100, createdById: adminUserId });
    await inventoryService.adjust({ productId: pid, quantity: -3, reason: 'damage', type: 'DAMAGE', createdById: adminUserId });

    const rows = await prisma.inventoryTransaction.findMany({ where: { productId: pid }, orderBy: { createdAt: 'asc' } });
    const adj = rows[rows.length - 1]!;
    assert.equal(adj.type, 'DAMAGE');
    assert.equal(adj.note, 'damage');
    assert.equal(adj.quantity, -3);
    assert.equal(adj.balanceAfter, 7);
  });
});