// Stage 6 — suppliers, purchasing & receiving integration verification
// against REAL PostgreSQL.
//
// Runs the purchasing services against a real database (makire_motorparts_test —
// a dedicated, disposable database so the development database is never
// touched). These tests verify the guarantees the in-memory mock cannot:
//   - receiving atomicity (PO row-lock serialization under real concurrency)
//   - cumulative receive limits across multiple receipts + status transitions
//   - weighted-average costing driven by actual receipts (exact DECIMAL on disk)
//   - supplier credit auto-charge and payment serialization (FOR UPDATE lock)
//   - document-number uniqueness under concurrency (atomic UPDATE..RETURNING)
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
import { DocumentType } from '@prisma/client';

const [{ default: prisma }, supplierService, purchaseOrderService, purchaseReceivingService, supplierCreditService, { nextDocumentNumber }] =
  await Promise.all([
    import('../../src/lib/prisma.js'),
    import('../../src/services/supplierService.js'),
    import('../../src/services/purchaseOrderService.js'),
    import('../../src/services/purchaseReceivingService.js'),
    import('../../src/services/supplierCreditService.js'),
    import('../../src/utils/documentNumber.js'),
  ]);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const actor = { id: '' };
const ctx = { actor };

let categoryId = '';
let brandId = '';
let productCounter = 0;

async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       "inventory_transactions", "stock_reservations", "inventories",
       "notifications", "audit_logs",
       "purchase_items", "purchases",
       "purchase_order_items", "purchase_orders",
       "supplier_credit_payments", "supplier_credit_accounts",
       "supplier_products", "suppliers",
       "document_sequences",
       "product_compatibilities", "product_identifiers", "products"
     RESTART IDENTITY CASCADE`,
  );
}

async function seedDocumentSequences(): Promise<void> {
  await prisma.documentSequence.createMany({
    data: [
      { documentType: DocumentType.PURCHASE_ORDER, prefix: 'PURCHASE_ORDER', lastNumber: 0, padLength: 6 },
      { documentType: DocumentType.PURCHASE, prefix: 'PURCHASE', lastNumber: 0, padLength: 6 },
    ],
  });
}

async function createProduct(): Promise<string> {
  productCounter += 1;
  const p = await prisma.product.create({
    data: {
      sku: `INT-${process.pid}-${Date.now()}-${productCounter}`,
      name: `Integration Product ${productCounter}`,
      categoryId,
      brandId,
      retailPrice: 100,
      wholesalePrice: 80,
      minimumStock: 3,
      reorderLevel: 2,
    },
  });
  return p.id;
}

async function createSupplier(name: string): Promise<string> {
  const s = await supplierService.createSupplier({ name }, ctx);
  return s.id;
}

async function createSubmittedPo(
  supplierId: string,
  productId: string,
  quantityOrdered: number,
  unitCost: number,
): Promise<{ poId: string; poItemId: string }> {
  const order = await purchaseOrderService.createPurchaseOrder(
    { supplierId, items: [{ productId, quantityOrdered, unitCost }] },
    ctx,
  );
  await purchaseOrderService.submitPurchaseOrder(order.id, ctx);
  const item = await prisma.purchaseOrderItem.findFirstOrThrow({ where: { purchaseOrderId: order.id } });
  return { poId: order.id, poItemId: item.id };
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
      tokenVersion: 0,
    },
  });
  actor.id = admin.id;
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
  await seedDocumentSequences();
});

after(async () => {
  await resetDb();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Receiving atomicity under concurrency
// ---------------------------------------------------------------------------

describe('receiving atomicity (real PostgreSQL)', () => {
  test('concurrent receives against one PO line never exceed the ordered quantity', async () => {
    const supplierId = await createSupplier('Concurrency Spares');
    const pid = await createProduct();
    const { poId, poItemId } = await createSubmittedPo(supplierId, pid, 10, 55);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        purchaseReceivingService.createPurchase(
          { purchaseOrderId: poId, items: [{ purchaseOrderItemId: poItemId, productId: pid, quantityReceived: 3 }] },
          ctx,
        ),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 3, 'exactly 3 of 6 concurrent receipts succeed (10 / 3)');
    assert.equal(rejected.length, 3, 'the remaining receipts are rejected');
    for (const r of rejected) {
      assert.equal((r as PromiseRejectedResult).reason.code, 'RECEIVED_QUANTITY_EXCEEDS_ORDERED');
    }

    const items = await prisma.purchaseItem.findMany({ where: { productId: pid } });
    const totalReceived = items.reduce((sum, i) => sum + i.quantityReceived, 0);
    assert.equal(totalReceived, 9, 'cumulative received equals accepted receipts only');

    const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    assert.equal(order.status, 'PARTIALLY_RECEIVED');

    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv!.quantityOnHand, 9, 'only accepted quantity entered stock');
  });

  test('an over-receiving request is rejected atomically (nothing persisted)', async () => {
    const supplierId = await createSupplier('Atomic Spares');
    const pid = await createProduct();
    const { poId, poItemId } = await createSubmittedPo(supplierId, pid, 10, 55);

    await assert.rejects(
      purchaseReceivingService.createPurchase(
        { purchaseOrderId: poId, items: [{ purchaseOrderItemId: poItemId, productId: pid, quantityReceived: 11 }] },
        ctx,
      ),
      (err: unknown) => (err as { code?: string }).code === 'RECEIVED_QUANTITY_EXCEEDS_ORDERED',
    );

    assert.equal(await prisma.purchase.count(), 0, 'no purchase row written');
    assert.equal(await prisma.purchaseItem.count(), 0, 'no purchase item written');
    assert.equal(await prisma.inventoryTransaction.count(), 0, 'no ledger row written');
    const inv = await prisma.inventory.findUnique({ where: { productId: pid } });
    assert.equal(inv, null, 'no inventory row created');
    const seq = await prisma.documentSequence.findUnique({
      where: { documentType: DocumentType.PURCHASE },
    });
    assert.equal(seq!.lastNumber, 0, 'failed receipt does not burn a document number');
  });

  test('damaged and missing units never enter stock but are recorded', async () => {
    const supplierId = await createSupplier('Fragile Spares');
    const pid = await createProduct();
    const { poId, poItemId } = await createSubmittedPo(supplierId, pid, 10, 40);

    const purchase = await purchaseReceivingService.createPurchase(
      {
        purchaseOrderId: poId,
        items: [{ purchaseOrderItemId: poItemId, productId: pid, quantityReceived: 5, quantityDamaged: 1, quantityMissing: 1 }],
      },
      ctx,
    );

    assert.equal(purchase.totalAmount.toNumber(), 120, 'total bills only accepted units (3 x 40)');
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(inv.quantityOnHand, 3);
    const item = await prisma.purchaseItem.findFirstOrThrow({ where: { purchaseId: purchase.id } });
    assert.equal(item.quantityDamaged, 1);
    assert.equal(item.quantityMissing, 1);
    assert.equal(item.quantityAccepted, 3);
  });
});

// ---------------------------------------------------------------------------
// Cumulative receive limits and status transitions
// ---------------------------------------------------------------------------

describe('cumulative receiving (real PostgreSQL)', () => {
  test('multiple receipts drive PENDING -> PARTIALLY_RECEIVED -> RECEIVED', async () => {
    const supplierId = await createSupplier('Steady Spares');
    const pid = await createProduct();
    const { poId, poItemId } = await createSubmittedPo(supplierId, pid, 10, 50);

    const first = await purchaseReceivingService.createPurchase(
      { purchaseOrderId: poId, items: [{ purchaseOrderItemId: poItemId, productId: pid, quantityReceived: 4 }] },
      ctx,
    );
    let order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    assert.equal(order.status, 'PARTIALLY_RECEIVED');

    const second = await purchaseReceivingService.createPurchase(
      { purchaseOrderId: poId, items: [{ purchaseOrderItemId: poItemId, productId: pid, quantityReceived: 6 }] },
      ctx,
    );
    order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    assert.equal(order.status, 'RECEIVED', 'fully received PO flips to RECEIVED');

    await assert.rejects(
      purchaseReceivingService.createPurchase(
        { purchaseOrderId: poId, items: [{ purchaseOrderItemId: poItemId, productId: pid, quantityReceived: 1 }] },
        ctx,
      ),
      (err: unknown) => (err as { code?: string }).code === 'PURCHASE_ORDER_ALREADY_RECEIVED',
    );

    assert.equal(first.totalAmount.toNumber(), 200);
    assert.equal(second.totalAmount.toNumber(), 300);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(inv.quantityOnHand, 10);
  });
});

// ---------------------------------------------------------------------------
// Weighted-average costing via receipts
// ---------------------------------------------------------------------------

describe('receipt costing (real PostgreSQL)', () => {
  test('receipts recompute weighted-average cost with exact DECIMAL persistence', async () => {
    const supplierId = await createSupplier('Costing Spares');
    const pid = await createProduct();

    await purchaseReceivingService.createPurchase(
      { supplierId, items: [{ productId: pid, quantityReceived: 10, quantityOrdered: 10, unitCost: 100 }] },
      ctx,
    );
    await purchaseReceivingService.createPurchase(
      { supplierId, items: [{ productId: pid, quantityReceived: 10, quantityOrdered: 10, unitCost: 200 }] },
      ctx,
    );

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(inv.weightedAverageCost.toFixed(2), '150.00', '(10*100 + 10*200) / 20 = 150.00 on disk');
    assert.equal(inv.quantityOnHand, 20);

    const rows = await prisma.inventoryTransaction.findMany({
      where: { productId: pid },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.unitCost!.toFixed(2), '100.00', 'ledger freezes each receipt cost');
    assert.equal(rows[1]!.unitCost!.toFixed(2), '200.00');
    assert.ok(rows.every((r) => r.type === 'PURCHASE'));
  });
});

// ---------------------------------------------------------------------------
// Supplier credit auto-charge and payment serialization
// ---------------------------------------------------------------------------

describe('supplier credit (real PostgreSQL)', () => {
  test('receiving auto-charges an active credit account; concurrent payments never overpay', async () => {
    const supplierId = await createSupplier('Credit Spares');
    const pid = await createProduct();
    await supplierCreditService.openCreditAccount(supplierId, ctx);

    const purchase = await purchaseReceivingService.createPurchase(
      { supplierId, items: [{ productId: pid, quantityReceived: 10, quantityOrdered: 10, unitCost: 55 }] },
      ctx,
    );
    assert.equal(purchase.creditAccountId !== null, true, 'purchase linked to the credit account');
    assert.equal(purchase.paymentStatus, 'UNPAID');

    let account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId } });
    assert.equal(account.outstandingBalance.toFixed(2), '550.00', 'balance charged by the receipt');

    // Six concurrent 200 payments against a 550 balance: exactly two succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        supplierCreditService.recordCreditPayment(supplierId, { amount: 200, paymentMethod: 'CASH' }, ctx),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 2, 'floor(550 / 200) = 2 payments succeed');
    assert.equal(rejected.length, 4);
    for (const r of rejected) {
      assert.equal((r as PromiseRejectedResult).reason.code, 'SUPPLIER_PAYMENT_EXCEEDS_BALANCE');
    }

    account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId } });
    assert.equal(account.outstandingBalance.toFixed(2), '150.00', 'balance never goes negative');
    const paid = await prisma.supplierCreditPayment.aggregate({ _sum: { amount: true } });
    assert.equal(paid._sum.amount!.toFixed(2), '400.00', 'payments sum to what was actually accepted');
  });

  test('paying a specific purchase in full marks it PAID', async () => {
    const supplierId = await createSupplier('Settled Spares');
    const pid = await createProduct();
    await supplierCreditService.openCreditAccount(supplierId, ctx);

    const purchase = await purchaseReceivingService.createPurchase(
      { supplierId, items: [{ productId: pid, quantityReceived: 4, quantityOrdered: 4, unitCost: 25 }] },
      ctx,
    );

    await supplierCreditService.recordCreditPayment(
      supplierId,
      { purchaseId: purchase.id, amount: 100, paymentMethod: 'BANK' },
      ctx,
    );

    const updated = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    assert.equal(updated.paymentStatus, 'PAID');
    const account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId } });
    assert.equal(account.outstandingBalance.toFixed(2), '0.00');
  });
});

// ---------------------------------------------------------------------------
// Document-number uniqueness under concurrency
// ---------------------------------------------------------------------------

describe('document numbering (real PostgreSQL)', () => {
  test('concurrent allocations produce unique sequential numbers', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 12 }, () =>
        prisma.$transaction((tx) => nextDocumentNumber(tx, DocumentType.PURCHASE)),
      ),
    );
    assert.equal(new Set(numbers).size, 12, 'no collisions under concurrency');
    const sorted = [...numbers].sort();
    assert.equal(sorted[0], 'PURCHASE-000001');
    assert.equal(sorted[sorted.length - 1], 'PURCHASE-000012');

    const seq = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType: DocumentType.PURCHASE },
    });
    assert.equal(seq.lastNumber, 12, 'sequence reflects every allocation');
  });

  test('concurrent purchases all receive distinct numbers', async () => {
    const supplierId = await createSupplier('Numbered Spares');
    const pid = await createProduct();
    const purchases = await Promise.all(
      Array.from({ length: 8 }, () =>
        purchaseReceivingService.createPurchase(
          { supplierId, items: [{ productId: pid, quantityReceived: 1, quantityOrdered: 1, unitCost: 10 }] },
          ctx,
        ),
      ),
    );
    const numbers = purchases.map((p) => p.purchaseNumber);
    assert.equal(new Set(numbers).size, 8);
    assert.deepEqual([...numbers].sort(), [
      'PURCHASE-000001',
      'PURCHASE-000002',
      'PURCHASE-000003',
      'PURCHASE-000004',
      'PURCHASE-000005',
      'PURCHASE-000006',
      'PURCHASE-000007',
      'PURCHASE-000008',
    ]);
  });
});
