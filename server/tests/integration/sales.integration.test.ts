// Stage 7 — sales/POS, customer credit, returns & expenses integration
// verification against REAL PostgreSQL.
//
// Runs the sales services against a real database (makire_motorparts_test —
// a dedicated, disposable database so the development database is never
// touched). These tests verify the guarantees the in-memory mock cannot:
//   - atomic sale creation (stock + COGS + payments + credit in ONE tx)
//   - concurrent sales competing for limited stock (no oversell, no negative)
//   - concurrent credit payments (FOR UPDATE serialization, no overpay)
//   - document-number uniqueness under concurrency
//   - exact DECIMAL reconciliation on disk (items = total, payments = total)
//   - rollback completeness when any step fails
//
// Run with: npm run test:integration   (requires a running PostgreSQL)

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-at-least-thirty-two-chars';
import 'dotenv/config';

const devUrl = process.env.DATABASE_URL ?? '';
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  devUrl.replace(/\/[^/]+$/, '/makire_motorparts_test');
process.env.DATABASE_URL = TEST_DATABASE_URL;

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentType, PaymentMethod, Prisma } from '@prisma/client';

const [
  { default: prisma },
  inventoryService,
  salesService,
  salesReturnService,
  customerService,
  customerCreditService,
  expenseService,
  reportsService,
] = await Promise.all([
  import('../../src/lib/prisma.js'),
  import('../../src/services/inventoryService.js'),
  import('../../src/services/salesService.js'),
  import('../../src/services/salesReturnService.js'),
  import('../../src/services/customerService.js'),
  import('../../src/services/customerCreditService.js'),
  import('../../src/services/expenseService.js'),
  import('../../src/services/reportsService.js'),
]);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const actor = { id: '' };
const ctx = { actor };

let productCounter = 0;
let categoryId = '';
let brandId = '';

async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       "inventory_transactions", "stock_reservations", "inventories",
       "notifications", "audit_logs",
       "sale_return_items", "sale_returns", "payments", "sale_items", "sales",
       "customer_credit_payments", "customer_credit_accounts",
       "expenses", "expense_categories", "customers",
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
      { documentType: DocumentType.SALE, prefix: 'SALE', lastNumber: 0, padLength: 6 },
      { documentType: DocumentType.SALE_RETURN, prefix: 'SALE_RETURN', lastNumber: 0, padLength: 6 },
    ],
  });
}

async function createProduct(name: string, retailPrice: number): Promise<string> {
  productCounter += 1;
  const p = await prisma.product.create({
    data: {
      sku: `S7-${process.pid}-${Date.now()}-${productCounter}`,
      name,
      categoryId,
      brandId,
      retailPrice,
      wholesalePrice: Math.round(retailPrice * 0.8),
      minimumStock: 2,
      reorderLevel: 3,
    },
  });
  return p.id;
}

async function stockProduct(productId: string, quantity: number, unitCost: number): Promise<void> {
  await inventoryService.increaseStock({ productId, quantity, unitCost, createdById: actor.id });
}

async function createCustomer(name: string, creditLimit: number): Promise<string> {
  const customer = await customerService.createCustomer({ name, type: 'RETAIL' }, ctx);
  await customerCreditService.openCreditAccount(customer.id, ctx);
  if (creditLimit > 0) {
    await customerCreditService.setCreditLimit(customer.id, creditLimit, ctx);
  }
  return customer.id;
}

interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
}

async function cashSale(items: SaleItemInput[], payments?: Array<{ paymentMethod: PaymentMethod; amount: number }>) {
  // Default: single full CASH allocation covering the retail total.
  let resolved = payments;
  if (!resolved) {
    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) } },
      select: { id: true, retailPrice: true },
    });
    const priceById = new Map(products.map((p) => [p.id, p.retailPrice]));
    const total = items.reduce(
      (sum, i) => sum + Number(priceById.get(i.productId)) * i.quantity - (i.discount ?? 0),
      0,
    );
    resolved = [{ paymentMethod: PaymentMethod.CASH, amount: Number(total.toFixed(2)) }];
  }
  return salesService.createSale({ items, payments: resolved }, ctx);
}

before(async () => {
  // Idempotent fixtures: TRUNCATE does not clear categories/brands/users, so
  // re-runs must upsert rather than create.
  const category = await prisma.category.upsert({
    where: { slug: 'sales-integration-parts' },
    create: { name: 'Sales Integration Parts', slug: 'sales-integration-parts' },
    update: {},
  });
  categoryId = category.id;
  const brand = await prisma.brand.upsert({
    where: { name: 'Integration Brand' },
    create: { name: 'Integration Brand' },
    update: {},
  });
  brandId = brand.id;

  const user = await prisma.user.upsert({
    where: { email: 'sales-int@makire.test' },
    create: {
      email: 'sales-int@makire.test',
      fullName: 'Sales Integration',
      passwordHash: 'x',
      role: 'ADMIN',
    },
    update: {},
  });
  actor.id = user.id;
});

after(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb();
  await seedDocumentSequences();
});

// ---------------------------------------------------------------------------
// A–D. Sale creation workflows
// ---------------------------------------------------------------------------

describe('sale creation (real PostgreSQL)', () => {
  test('A. cash sale: totals, frozen COGS, stock deduction and ledger', async () => {
    const productId = await createProduct('Brake Pad', 100);
    await stockProduct(productId, 20, 40);

    const sale = await cashSale([{ productId, quantity: 3 }]);

    assert.equal(sale.saleNumber, 'SALE-000001');
    assert.equal(sale.subtotal, '300.00');
    assert.equal(sale.totalAmount, '300.00');
    assert.equal(sale.cogs, '120.00'); // 3 x 40 frozen at movement time
    assert.equal(sale.grossProfit, '180.00');

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 17);

    const txn = await prisma.inventoryTransaction.findFirstOrThrow({
      where: { type: 'SALE', referenceId: { not: null } },
    });
    assert.equal(txn.quantity, -3);
    assert.equal(txn.unitCost.toFixed(2), '40.00');

    // Reconciliation on disk: items sum - discount == total; payments == total.
    const dbSale = await prisma.sale.findUniqueOrThrow({
      where: { id: String(sale.id) },
      include: { items: true, payments: true },
    });
    const itemSum = dbSale.items.reduce((sum, item) => sum.add(item.lineTotal), new Prisma.Decimal(0));
    assert.ok(itemSum.sub(dbSale.discount).equals(dbSale.totalAmount));
    const paidSum = dbSale.payments.reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
    assert.ok(paidSum.equals(dbSale.totalAmount));
  });

  test('B. mobile-money sale with reference is recorded', async () => {
    const productId = await createProduct('Chain', 200);
    await stockProduct(productId, 10, 120);

    const sale = await salesService.createSale(
      {
        items: [{ productId, quantity: 1 }],
        payments: [{ paymentMethod: PaymentMethod.MPESA, amount: 200, reference: 'QGH72XYZ' }],
      },
      ctx,
    );

    assert.equal(sale.totalAmount, '200.00');
    const payment = await prisma.payment.findFirstOrThrow({ where: { saleId: String(sale.id) } });
    assert.equal(payment.paymentMethod, PaymentMethod.MPESA);
    assert.equal(payment.reference, 'QGH72XYZ');
  });

  test('C. credit sale charges the account within the limit', async () => {
    const productId = await createProduct('Sprocket', 500);
    await stockProduct(productId, 10, 300);
    const customerId = await createCustomer('John Mechanic', 5000);

    const sale = await salesService.createSale(
      {
        items: [{ productId, quantity: 4 }],
        customerId,
        payments: [{ paymentMethod: PaymentMethod.CREDIT, amount: 2000 }],
      },
      ctx,
    );

    assert.equal(sale.creditAmount, '2000.00');
    const account = await prisma.customerCreditAccount.findUniqueOrThrow({ where: { customerId } });
    assert.equal(account.outstandingBalance.toFixed(2), '2000.00');
  });

  test('D. mixed payment: cash + M-Pesa + credit split a sale', async () => {
    const productId = await createProduct('Spare Kit', 1000);
    await stockProduct(productId, 10, 600);
    const customerId = await createCustomer('Garage Y', 10000);

    const sale = await salesService.createSale(
      {
        items: [{ productId, quantity: 1 }],
        customerId,
        payments: [
          { paymentMethod: PaymentMethod.CASH, amount: 400 },
          { paymentMethod: PaymentMethod.MPESA, amount: 300 },
          { paymentMethod: PaymentMethod.CREDIT, amount: 300 },
        ],
      },
      ctx,
    );

    assert.equal(sale.totalAmount, '1000.00');
    assert.equal(sale.paidAmount, '700.00');
    assert.equal(sale.creditAmount, '300.00');
    const account = await prisma.customerCreditAccount.findUniqueOrThrow({ where: { customerId } });
    assert.equal(account.outstandingBalance.toFixed(2), '300.00');
  });

  test('payment allocations that do not sum to the total are rejected', async () => {
    const productId = await createProduct('Mirror', 100);
    await stockProduct(productId, 5, 50);

    await assert.rejects(
      salesService.createSale(
        {
          items: [{ productId, quantity: 1 }],
          payments: [{ paymentMethod: PaymentMethod.CASH, amount: 90 }],
        },
        ctx,
      ),
      (err: Error) => (err as { code?: string }).code === 'PAYMENT_MISMATCH',
    );
    assert.equal(await prisma.sale.count(), 0);
  });

  test('credit above the available limit rolls back everything', async () => {
    const productId = await createProduct('Expensive Part', 9000);
    await stockProduct(productId, 10, 4000);
    const customerId = await createCustomer('Small Shop', 5000);

    await assert.rejects(
      salesService.createSale(
        {
          items: [{ productId, quantity: 1 }],
          customerId,
          payments: [{ paymentMethod: PaymentMethod.CREDIT, amount: 9000 }],
        },
        ctx,
      ),
      (err: Error) => (err as { code?: string }).code === 'CREDIT_LIMIT_EXCEEDED',
    );

    assert.equal(await prisma.sale.count(), 0);
    assert.equal(await prisma.payment.count(), 0);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 10, 'stock untouched after rollback');
    const account = await prisma.customerCreditAccount.findUniqueOrThrow({ where: { customerId } });
    assert.equal(account.outstandingBalance.toFixed(2), '0.00');
  });
});

// ---------------------------------------------------------------------------
// E–F. Credit payments
// ---------------------------------------------------------------------------

describe('customer credit payments (real PostgreSQL)', () => {
  test('E+F. partial then full payment clears the balance; overpay rejected', async () => {
    const productId = await createProduct('Battery', 2000);
    await stockProduct(productId, 10, 1200);
    const customerId = await createCustomer('Fleet Customer', 50000);

    await salesService.createSale(
      {
        items: [{ productId, quantity: 5 }],
        customerId,
        payments: [{ paymentMethod: PaymentMethod.CREDIT, amount: 10000 }],
      },
      ctx,
    );

    // Overpayment rejected.
    await assert.rejects(
      customerCreditService.recordCreditPayment(customerId, { amount: 15000, paymentMethod: PaymentMethod.CASH }, ctx),
      (err: Error) => (err as { code?: string }).code === 'PAYMENT_EXCEEDS_BALANCE',
    );

    // Partial.
    const partial = await customerCreditService.recordCreditPayment(
      customerId,
      { amount: 6000, paymentMethod: PaymentMethod.MPESA, reference: 'PAY-1' },
      ctx,
    );
    assert.equal(partial.newBalance.toFixed(2), '4000.00');

    // Full.
    const full = await customerCreditService.recordCreditPayment(
      customerId,
      { amount: 4000, paymentMethod: PaymentMethod.CASH },
      ctx,
    );
    assert.equal(full.newBalance.toFixed(2), '0.00');

    const account = await prisma.customerCreditAccount.findUniqueOrThrow({ where: { customerId } });
    assert.equal(account.outstandingBalance.toFixed(2), '0.00');
    assert.equal(await prisma.customerCreditPayment.count({ where: { account: { customerId } } }), 2);
  });

  test('statement reconciles debits and credits to the account balance', async () => {
    const productId = await createProduct('Tyre', 800);
    await stockProduct(productId, 10, 500);
    const customerId = await createCustomer('Statement Customer', 20000);

    await salesService.createSale(
      {
        items: [{ productId, quantity: 10 }],
        customerId,
        payments: [{ paymentMethod: PaymentMethod.CREDIT, amount: 8000 }],
      },
      ctx,
    );
    await customerCreditService.recordCreditPayment(customerId, { amount: 3000, paymentMethod: PaymentMethod.CASH }, ctx);

    const statement = await customerCreditService.getStatement(customerId, {});
    assert.equal(statement.rows.length, 2);
    const lastBalance = statement.rows[statement.rows.length - 1].balance;
    const account = await prisma.customerCreditAccount.findUniqueOrThrow({ where: { customerId } });
    assert.equal(lastBalance, account.outstandingBalance.toFixed(2));
  });
});

// ---------------------------------------------------------------------------
// G–I. Returns
// ---------------------------------------------------------------------------

describe('sales returns (real PostgreSQL)', () => {
  test('G. partial GOOD return restores stock at the original frozen cost', async () => {
    const productId = await createProduct('Brake Shoe', 250);
    await stockProduct(productId, 10, 150);
    const sale = await cashSale([{ productId, quantity: 6 }]);
    const saleItemId = String((sale.items as Array<{ id: string }>)[0].id);

    const saleReturn = await salesReturnService.createSaleReturn(
      String(sale.id),
      {
        items: [{ saleItemId, quantity: 2, condition: 'GOOD' }],
        reason: 'Wrong size',
        refundMethod: PaymentMethod.CASH,
      },
      ctx,
    );

    assert.match(saleReturn.returnNumber, /^SALE_RETURN-\d{6}$/);
    assert.equal(saleReturn.totalAmount, '500.00');

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 6); // 10 - 6 sold + 2 returned

    const txn = await prisma.inventoryTransaction.findFirstOrThrow({ where: { type: 'SALE_RETURN' } });
    assert.equal(txn.unitCost.toFixed(2), '150.00', 'restored at historical cost, not current average');
  });

  test('G2. DAMAGED returns are recorded but never restocked', async () => {
    const productId = await createProduct('Visor', 100);
    await stockProduct(productId, 10, 60);
    const sale = await cashSale([{ productId, quantity: 4 }]);
    const saleItemId = String((sale.items as Array<{ id: string }>)[0].id);

    await salesReturnService.createSaleReturn(
      String(sale.id),
      {
        items: [{ saleItemId, quantity: 1, condition: 'DAMAGED' }],
        reason: 'Cracked',
        refundMethod: PaymentMethod.CASH,
      },
      ctx,
    );

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 6, 'damaged stock not restored');
  });

  test('H. full return exhausts the returnable quantity', async () => {
    const productId = await createProduct('Lever', 120);
    await stockProduct(productId, 10, 70);
    const sale = await cashSale([{ productId, quantity: 3 }]);
    const saleItemId = String((sale.items as Array<{ id: string }>)[0].id);

    await salesReturnService.createSaleReturn(
      String(sale.id),
      { items: [{ saleItemId, quantity: 3 }], reason: 'All units faulty', refundMethod: PaymentMethod.BANK },
      ctx,
    );

    await assert.rejects(
      salesReturnService.createSaleReturn(
        String(sale.id),
        { items: [{ saleItemId, quantity: 1 }], reason: 'Nothing left to return', refundMethod: PaymentMethod.CASH },
        ctx,
      ),
      (err: Error) => (err as { code?: string }).code === 'RETURN_EXCEEDS_RETURNABLE',
    );
  });

  test('I. return from a credit sale adjusts the outstanding balance', async () => {
    const productId = await createProduct('Headlight', 600);
    await stockProduct(productId, 10, 350);
    const customerId = await createCustomer('Credit Return Customer', 20000);

    const sale = await salesService.createSale(
      {
        items: [{ productId, quantity: 5 }],
        customerId,
        payments: [{ paymentMethod: PaymentMethod.CREDIT, amount: 3000 }],
      },
      ctx,
    );
    const saleItemId = String((sale.items as Array<{ id: string }>)[0].id);

    await salesReturnService.createSaleReturn(
      String(sale.id),
      { items: [{ saleItemId, quantity: 2, condition: 'GOOD' }], reason: 'Customer returned surplus', creditAdjusted: true },
      ctx,
    );

    const account = await prisma.customerCreditAccount.findUniqueOrThrow({ where: { customerId } });
    assert.equal(account.outstandingBalance.toFixed(2), '1800.00'); // 3000 - 1200

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 7);
  });

  test('credit adjustment beyond the balance is rejected atomically', async () => {
    const productId = await createProduct('Horn', 90);
    await stockProduct(productId, 10, 40);
    const customerId = await createCustomer('Tiny Limit', 1000);

    const sale = await salesService.createSale(
      {
        items: [{ productId, quantity: 5 }],
        customerId,
        payments: [{ paymentMethod: PaymentMethod.CREDIT, amount: 450 }],
      },
      ctx,
    );
    const saleItemId = String((sale.items as Array<{ id: string }>)[0].id);

    // Pay down the balance first so the adjustment would exceed it.
    await customerCreditService.recordCreditPayment(customerId, { amount: 450, paymentMethod: PaymentMethod.CASH }, ctx);

    await assert.rejects(
      salesReturnService.createSaleReturn(
        String(sale.id),
        { items: [{ saleItemId, quantity: 1 }], reason: 'No balance left', creditAdjusted: true },
        ctx,
      ),
      (err: Error) => (err as { code?: string }).code === 'REFUND_EXCEEDS_BALANCE',
    );

    assert.equal(await prisma.saleReturn.count(), 0, 'return rolled back');
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 5, 'stock untouched after rollback');
  });
});

// ---------------------------------------------------------------------------
// J. Expenses
// ---------------------------------------------------------------------------

describe('expenses (real PostgreSQL)', () => {
  test('J. expense lifecycle: create, void excluded from active totals', async () => {
    const category = await expenseService.createExpenseCategory({ name: 'Rent' }, ctx);
    await expenseService.createExpense({ categoryId: category.id, amount: 300000, description: 'Shop rent' }, ctx);
    const power = await expenseService.createExpense({ categoryId: category.id, amount: 45000 }, ctx);

    let summary = await reportsService.expenseSummary({ from: new Date('2020-01-01'), to: new Date('2030-01-01') });
    assert.equal(summary.total, '345000.00');

    await expenseService.voidExpense(power.id, ctx);

    summary = await reportsService.expenseSummary({ from: new Date('2020-01-01'), to: new Date('2030-01-01') });
    assert.equal(summary.total, '300000.00', 'voided expense excluded');

    // Record still exists (no physical delete).
    assert.equal(await prisma.expense.count(), 2);
  });
});

// ---------------------------------------------------------------------------
// K–O. Concurrency & atomicity on real row locks
// ---------------------------------------------------------------------------

describe('concurrency (real PostgreSQL locks)', () => {
  test('K. six concurrent sales of 2 units against stock of 10: exactly five succeed', async () => {
    const productId = await createProduct('Hot Item', 300);
    await stockProduct(productId, 10, 180);

    const attempts = Array.from({ length: 6 }, () =>
      salesService.createSale(
        { items: [{ productId, quantity: 2 }], payments: [{ paymentMethod: PaymentMethod.CASH, amount: 600 }] },
        ctx,
      ),
    );
    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 5, JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason?.message)));
    assert.equal(rejected.length, 1);

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 0, 'stock exactly exhausted, never negative');
    assert.equal(await prisma.sale.count(), 5);
    assert.equal(await prisma.saleItem.count(), 5);
  });

  test('K2. concurrent sale vs stock adjustment cannot go negative', async () => {
    const productId = await createProduct('Contested Part', 100);
    await stockProduct(productId, 5, 50);

    const operations = [
      salesService.createSale({ items: [{ productId, quantity: 5 }], payments: [{ paymentMethod: PaymentMethod.CASH, amount: 500 }] }, ctx),
      inventoryService.adjust({ productId, quantity: -3, reason: 'Damage write-off', type: 'DAMAGE', createdById: actor.id }),
    ];
    const results = await Promise.allSettled(operations);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;

    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.ok(inv.quantityOnHand >= 0, 'never negative');
    assert.equal(fulfilled, 1, 'only one of sale/adjustment can win with 5 units of stock');
  });

  test('L. ten concurrent credit payments of 300 against balance 1000: exactly three succeed', async () => {
    const productId = await createProduct('Credit Magnet', 500);
    await stockProduct(productId, 20, 200);
    const customerId = await createCustomer('Payment Racer', 50000);

    await salesService.createSale(
      {
        items: [{ productId, quantity: 2 }],
        customerId,
        payments: [{ paymentMethod: PaymentMethod.CREDIT, amount: 1000 }],
      },
      ctx,
    );

    const attempts = Array.from({ length: 10 }, () =>
      customerCreditService.recordCreditPayment(customerId, { amount: 300, paymentMethod: PaymentMethod.CASH }, ctx),
    );
    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.equal(fulfilled.length, 3, 'only three payments fit under the balance');

    const account = await prisma.customerCreditAccount.findUniqueOrThrow({ where: { customerId } });
    assert.equal(account.outstandingBalance.toFixed(2), '100.00');
    assert.equal(await prisma.customerCreditPayment.count({ where: { account: { customerId } } }), 3);
  });

  test('M. failed sale leaves zero trace anywhere', async () => {
    const productIdA = await createProduct('Rollback A', 100);
    const productIdB = await createProduct('Rollback B', 100);
    await stockProduct(productIdA, 10, 50);
    await stockProduct(productIdB, 1, 50); // second line will fail

    await assert.rejects(
      salesService.createSale(
        {
          items: [
            { productId: productIdA, quantity: 2 },
            { productId: productIdB, quantity: 5 },
          ],
          payments: [{ paymentMethod: PaymentMethod.CASH, amount: 700 }],
        },
        ctx,
      ),
      (err: Error) => (err as { code?: string }).code === 'INSUFFICIENT_STOCK',
    );

    assert.equal(await prisma.sale.count(), 0);
    assert.equal(await prisma.saleItem.count(), 0);
    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await prisma.inventoryTransaction.count({ where: { type: 'SALE' } }), 0);
    const invA = await prisma.inventory.findUniqueOrThrow({ where: { productId: productIdA } });
    assert.equal(invA.quantityOnHand, 10, 'first line deduction rolled back too');
  });

  test('N. failed return leaves zero trace and no stock change', async () => {
    const productId = await createProduct('Return Rollback', 100);
    await stockProduct(productId, 10, 50);
    const sale = await cashSale([{ productId, quantity: 2 }]);
    const saleItemId = String((sale.items as Array<{ id: string }>)[0].id);

    await assert.rejects(
      salesReturnService.createSaleReturn(
        String(sale.id),
        { items: [{ saleItemId, quantity: 99 }], reason: 'Impossible quantity', refundMethod: PaymentMethod.CASH },
        ctx,
      ),
      (err: Error) => (err as { code?: string }).code === 'RETURN_EXCEEDS_RETURNABLE',
    );

    assert.equal(await prisma.saleReturn.count(), 0);
    assert.equal(await prisma.saleReturnItem.count(), 0);
    assert.equal(await prisma.inventoryTransaction.count({ where: { type: 'SALE_RETURN' } }), 0);
    const inv = await prisma.inventory.findUniqueOrThrow({ where: { productId } });
    assert.equal(inv.quantityOnHand, 8);
  });

  test('O. twenty concurrent sales receive unique sequential document numbers', async () => {
    const productId = await createProduct('Number Racer', 50);
    await stockProduct(productId, 20, 20);

    const attempts = Array.from({ length: 20 }, () =>
      salesService.createSale(
        { items: [{ productId, quantity: 1 }], payments: [{ paymentMethod: PaymentMethod.CASH, amount: 50 }] },
        ctx,
      ),
    );
    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.equal(fulfilled.length, 20);

    const numbers = fulfilled.map(
      (r) => (r as PromiseFulfilledResult<{ saleNumber: string }>).value.saleNumber,
    );
    assert.equal(new Set(numbers).size, 20, 'all numbers unique');
    for (let i = 1; i <= 20; i += 1) {
      assert.ok(numbers.includes(`SALE-${String(i).padStart(6, '0')}`), `missing SALE-${String(i).padStart(6, '0')}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Reporting foundation
// ---------------------------------------------------------------------------

describe('reporting foundation (real PostgreSQL aggregates)', () => {
  test('financial report separates revenue, COGS, gross profit and expenses', async () => {
    const productId = await createProduct('Report Part', 1000);
    await stockProduct(productId, 10, 400);
    const category = await expenseService.createExpenseCategory({ name: 'Utilities' }, ctx);

    await cashSale([{ productId, quantity: 4 }]); // revenue 4000, cogs 1600
    await expenseService.createExpense({ categoryId: category.id, amount: 500 }, ctx);

    const range = { from: new Date(Date.now() - 24 * 3600 * 1000), to: new Date(Date.now() + 24 * 3600 * 1000) };
    const report = await reportsService.financialReport(range);

    assert.equal(report.sales.revenue, '4000.00');
    assert.equal(report.sales.cogs, '1600.00');
    assert.equal(report.sales.grossProfit, '2400.00');
    assert.equal(report.expenses.total, '500.00');
    assert.equal(report.netOperatingResult.grossProfit, '2400.00');
    assert.equal(report.netOperatingResult.operatingExpenses, '500.00');
    assert.equal(report.netOperatingResult.netOperatingResult, '1900.00');
  });

  test('voided sales are excluded from report totals', async () => {
    const productId = await createProduct('Void Report Part', 200);
    await stockProduct(productId, 10, 80);

    const sale = await cashSale([{ productId, quantity: 2 }]);
    await salesService.voidSale(String(sale.id), 'Mistake', ctx);

    const range = { from: new Date(Date.now() - 24 * 3600 * 1000), to: new Date(Date.now() + 24 * 3600 * 1000) };
    const summary = await reportsService.salesSummary(range);
    assert.equal(summary.revenue, '0.00');
    assert.equal(summary.cogs, '0.00');
  });
});
