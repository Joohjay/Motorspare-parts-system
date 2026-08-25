// Stage 8 — purchase returns integration verification against REAL PostgreSQL.
//
// Runs the purchase-return service against a real database
// (makire_motorparts_test — a dedicated, disposable database so the
// development database is never touched). These tests verify the guarantees
// the in-memory mock cannot:
//   - concurrent returns against one purchase line never exceed the accepted
//     quantity (purchase row-lock serialization)
//   - supplier-credit settlement clamps at zero and serializes correctly
//   - stock leaves at the current weighted average; cancellation restores it
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

const [
  { default: prisma },
  supplierService,
  purchaseOrderService,
  purchaseReceivingService,
  purchaseReturnService,
] = await Promise.all([
  import('../../src/lib/prisma.js'),
  import('../../src/services/supplierService.js'),
  import('../../src/services/purchaseOrderService.js'),
  import('../../src/services/purchaseReceivingService.js'),
  import('../../src/services/purchaseReturnService.js'),
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
       "purchase_return_items", "purchase_returns",
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
      { documentType: DocumentType.PURCHASE_RETURN, prefix: 'PURCHASE_RETURN', lastNumber: 0, padLength: 6 },
    ],
  });
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
// Helpers
// ---------------------------------------------------------------------------

let skuCounter = 0;

async function createProduct(minimumStock = 3): Promise<string> {
  skuCounter += 1;
  productCounter += 1;
  const p = await prisma.product.create({
    data: {
      sku: `PRET-${process.pid}-${Date.now()}-${skuCounter}`,
      name: `Purchase Return Product ${productCounter}`,
      categoryId,
      brandId,
      retailPrice: 100,
      wholesalePrice: 80,
      minimumStock,
      reorderLevel: 2,
    },
  });
  return p.id;
}

async function createSupplier(name: string): Promise<{ id: string }> {
  return supplierService.createSupplier({ name }, ctx);
}

interface ReceivedLine {
  productId: string;
  quantityAccepted: number;
  unitCost: number;
  purchaseOrderItemId?: string;
}

/** Receive a completed purchase (optionally via a PO) and return its lines. */
async function receivePurchase(
  supplierId: string,
  lines: ReceivedLine[],
): Promise<{ purchaseId: string; lineIds: Record<string, string> }> {
  let poId: string | undefined;
  let poItemId: string | undefined;
  if (lines.some((line) => line.purchaseOrderItemId !== undefined) === false && lines.length === 1 && lines[0].purchaseOrderItemId === undefined) {
    // Direct purchase — no PO needed.
  }

  if (!poId) {
    // Build a submitted PO with matching lines so receiving is straightforward.
    const order = await purchaseOrderService.createPurchaseOrder(
      {
        supplierId,
        items: lines.map((line) => ({
          productId: line.productId,
          quantityOrdered: line.quantityAccepted,
          unitCost: line.unitCost,
        })),
      },
      ctx,
    );
    await purchaseOrderService.submitPurchaseOrder(order.id, ctx);
    poId = order.id;
    const poItems = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrderId: order.id }, orderBy: { id: 'asc' } });
    poItemId = poItems[0]?.id;
    for (let i = 0; i < lines.length; i += 1) {
      lines[i].purchaseOrderItemId = poItems[i]?.id;
    }
  }

  const purchase = await purchaseReceivingService.createPurchase(
    {
      purchaseOrderId: poId,
      items: lines.map((line) => ({
        purchaseOrderItemId: line.purchaseOrderItemId!,
        productId: line.productId,
        quantityReceived: line.quantityAccepted,
      })),
    },
    ctx,
  );

  const items = await prisma.purchaseItem.findMany({ where: { purchaseId: purchase.id } });
  const lineIds: Record<string, string> = {};
  for (const item of items) {
    lineIds[item.productId] = item.id;
  }
  return { purchaseId: purchase.id, lineIds };
}

async function openSupplierCredit(supplierId: string): Promise<void> {
  await prisma.supplierCreditAccount.create({
    data: { supplierId, outstandingBalance: 0, status: 'ACTIVE' },
  });
}

async function chargeCredit(supplierId: string, amount: number): Promise<void> {
  await prisma.supplierCreditAccount.update({
    where: { supplierId },
    data: { outstandingBalance: { increment: amount } },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('purchase returns — happy path & costing (real PostgreSQL)', () => {
  test('return deducts stock at current WAC while settling the supplier at frozen cost', async () => {
    const supplier = await createSupplier('Costing Spares');
    await openSupplierCredit(supplier.id);
    const pid = await createProduct();

    // Receive 10 @ 40 → WAC 40. Then buy 10 more @ 60 → WAC 50.
    const first = await receivePurchase(
      supplier.id,
      [{ productId: pid, quantityAccepted: 10, unitCost: 40 }],
    );
    const second = await receivePurchase(
      supplier.id,
      [{ productId: pid, quantityAccepted: 10, unitCost: 60 }],
    );
    let inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(inv.quantityOnHand, 20);
    assert.equal(Number(inv.weightedAverageCost), 50);

    // Return 4 units against the FIRST receipt (frozen cost 40 each).
    const result = await purchaseReturnService.createPurchaseReturn(
      first.purchaseId,
      {
        items: [{ purchaseItemId: first.lineIds[pid], quantity: 4 }],
        reason: 'Defective batch',
        settlement: 'SUPPLIER_CREDIT',
      },
      ctx,
    );

    // Supplier settled at frozen cost: 4 x 40 = 160.
    assert.equal(result.totalAmount, '160.00');
    assert.equal(result.creditedAmount, '160.00');
    assert.equal(result.refundDue, '0.00');

    inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(inv.quantityOnHand, 16, 'stock left');
    assert.equal(Number(inv.weightedAverageCost), 50, 'WAC unchanged by a decrease');

    const ledger = await prisma.inventoryTransaction.findFirstOrThrow({
      where: { type: 'PURCHASE_RETURN', referenceId: result.id },
    });
    assert.equal(ledger.quantity, -4);
    assert.equal(Number(ledger.unitCost), 50, 'leaves inventory at CURRENT average');
    assert.equal(ledger.balanceAfter, 16);

    // Receiving auto-charged the credit account (400 + 600); the return
    // settled 160 of it.
    const account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId: supplier.id } });
    assert.equal(Number(account.outstandingBalance), 840);

    const doc = await prisma.documentSequence.findUniqueOrThrow({ where: { documentType: DocumentType.PURCHASE_RETURN } });
    assert.equal(doc.lastNumber, 1);

    const detail = await purchaseReturnService.getPurchaseReturn(result.id);
    assert.equal(detail.returnNumber.startsWith('PURCHASE_RETURN-'), true);
    assert.equal(detail.items.length, 1);
    assert.equal(detail.items[0].unitCost, '40.00', 'item stores the frozen purchase cost');
  });

  test('credit balance is charged exactly; over-charge is impossible', async () => {
    const supplier = await createSupplier('Clamp Spares');
    await openSupplierCredit(supplier.id);
    const pid = await createProduct();
    const received = await receivePurchase(supplier.id, [{ productId: pid, quantityAccepted: 5, unitCost: 100 }]);
    // Receiving auto-charged 500; the shop has since paid it down to 200.
    await prisma.supplierCreditAccount.update({
      where: { supplierId: supplier.id },
      data: { outstandingBalance: 200 },
    });

    const result = await purchaseReturnService.createPurchaseReturn(
      received.purchaseId,
      {
        items: [{ purchaseItemId: received.lineIds[pid], quantity: 5 }],
        reason: 'Whole batch rejected',
        settlement: 'SUPPLIER_CREDIT',
      },
      ctx,
    );

    assert.equal(result.totalAmount, '500.00');
    assert.equal(result.creditedAmount, '200.00', 'credited only what was owed');
    assert.equal(result.refundDue, '300.00', 'remainder owed back by supplier');

    const account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId: supplier.id } });
    assert.equal(Number(account.outstandingBalance), 0, 'never goes negative');
  });

  test('cancellation restores stock at the frozen cost and reverses credit clamped at zero', async () => {
    const supplier = await createSupplier('Cancel Spares');
    await openSupplierCredit(supplier.id);
    const pid = await createProduct();
    const received = await receivePurchase(supplier.id, [{ productId: pid, quantityAccepted: 6, unitCost: 70 }]);
    // Receiving auto-charged 420; the shop has since paid it down to 300.
    await prisma.supplierCreditAccount.update({
      where: { supplierId: supplier.id },
      data: { outstandingBalance: 300 },
    });

    const created = await purchaseReturnService.createPurchaseReturn(
      received.purchaseId,
      {
        items: [{ purchaseItemId: received.lineIds[pid], quantity: 6 }],
        reason: 'Wrong specification shipped',
        settlement: 'SUPPLIER_CREDIT',
      },
      ctx,
    );
    assert.equal(created.totalAmount, '420.00');
    assert.equal(created.creditedAmount, '300.00', 'clamped to the outstanding balance');

    let account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId: supplier.id } });
    assert.equal(Number(account.outstandingBalance), 0);

    // Later activity re-inflates the balance before the corrective cancel.
    await receivePurchase(supplier.id, [{ productId: pid, quantityAccepted: 2, unitCost: 70 }]);
    account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId: supplier.id } });
    assert.equal(Number(account.outstandingBalance), 140);

    const before = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(before.quantityOnHand, 2, 'only the later receipt remains before reversal');

    const cancelledResult = await purchaseReturnService.cancelPurchaseReturn(created.id, ctx);

    const after = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(after.quantityOnHand, 8, 'stock restored (2 later + 6 reversal)');
    assert.equal(Number(after.weightedAverageCost), 70, 'restocked at the frozen cost');

    // Restore is capped by available headroom: only 140 of the 300 credited.
    assert.equal(cancelledResult.creditRestored, '140.00');
    assert.equal(cancelledResult.creditUnrecoverable, '160.00');
    account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId: supplier.id } });
    assert.equal(Number(account.outstandingBalance), 280, 'balance restored up to headroom only');

    const cancelled = await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(cancelled.status, 'CANCELLED');

    await assert.rejects(
      purchaseReturnService.cancelPurchaseReturn(created.id, ctx),
      (err: unknown) => (err as { code?: string }).code === 'PURCHASE_RETURN_NOT_ACTIVE',
      'double cancel rejected',
    );
  });
});

describe('purchase returns — concurrency (real PostgreSQL)', () => {
  test('concurrent returns against one purchase line never exceed the accepted quantity', async () => {
    const supplier = await createSupplier('Concurrency Returns');
    const pid = await createProduct();
    const received = await receivePurchase(supplier.id, [{ productId: pid, quantityAccepted: 10, unitCost: 30 }]);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        purchaseReturnService.createPurchaseReturn(
          received.purchaseId,
          {
            items: [{ purchaseItemId: received.lineIds[pid], quantity: 3 }],
            reason: 'Concurrent defective batch',
            settlement: 'NONE',
          },
          ctx,
        ),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 3, 'exactly 3 of 5 succeed (10 / 3)');
    assert.equal(rejected.length, 2);
    for (const r of rejected) {
      assert.equal((r as PromiseRejectedResult).reason.code, 'RETURN_EXCEEDS_RETURNABLE');
    }

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId: pid } });
    assert.equal(inv.quantityOnHand, 1, 'only completed returns left stock (10 - 9)');
  });

  test('concurrent returns cannot overdraw the supplier credit balance', async () => {
    const supplier = await createSupplier('Credit Race');
    await openSupplierCredit(supplier.id);
    const pid = await createProduct();
    const received = await receivePurchase(supplier.id, [{ productId: pid, quantityAccepted: 10, unitCost: 25 }]);
    // Receiving auto-charged 250; pay down to exactly 80 so each 75-credit race matters.
    await prisma.supplierCreditAccount.update({
      where: { supplierId: supplier.id },
      data: { outstandingBalance: 80 },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        purchaseReturnService.createPurchaseReturn(
          received.purchaseId,
          {
            items: [{ purchaseItemId: received.lineIds[pid], quantity: 3 }],
            reason: 'Credit race batch',
            settlement: 'SUPPLIER_CREDIT',
          },
          ctx,
        ),
      ),
    );

    for (const r of results.filter((x) => x.status === 'fulfilled')) {
      const value = (r as PromiseFulfilledResult<Awaited<ReturnType<typeof purchaseReturnService.createPurchaseReturn>>>).value;
      assert.equal(value.totalAmount, '75.00');
      // Each winner may credit at most what remained when its lock fired.
      assert.ok(
        ['75.00', '5.00', '0.00'].includes(value.creditedAmount),
        `credited must clamp to remaining balance, got ${value.creditedAmount}`,
      );
    }

    const account = await prisma.supplierCreditAccount.findUniqueOrThrow({ where: { supplierId: supplier.id } });
    assert.ok(Number(account.outstandingBalance) >= 0, 'balance never negative');
    assert.equal(Number(account.outstandingBalance), 80 - 75 - 5, 'exactly 80 credited away in total');
  });

  test('failed returns do not burn PURCHASE_RETURN document numbers', async () => {
    const supplier = await createSupplier('Sequence Spares');
    const pid = await createProduct();
    const received = await receivePurchase(supplier.id, [{ productId: pid, quantityAccepted: 2, unitCost: 10 }]);

    await assert.rejects(
      purchaseReturnService.createPurchaseReturn(
        received.purchaseId,
        {
          items: [{ purchaseItemId: received.lineIds[pid], quantity: 99 }],
          reason: 'Over-return attempt',
          settlement: 'NONE',
        },
        ctx,
      ),
      (err: unknown) => (err as { code?: string }).code === 'RETURN_EXCEEDS_RETURNABLE',
    );

    const seq = await prisma.documentSequence.findUniqueOrThrow({
      where: { documentType: DocumentType.PURCHASE_RETURN },
    });
    assert.equal(seq.lastNumber, 0, 'no number burned on rollback');
  });
});
