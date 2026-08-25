import { DocumentType, PaymentMethod, Prisma, ProductStatus, SaleStatus } from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { paginate } from '../utils/pagination.js';
import { nextDocumentNumber } from '../utils/documentNumber.js';
import { decreaseStockTx, increaseStockTx } from './inventoryService.js';
import { chargeCreditTx } from './customerCreditService.js';

type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
  role: 'ADMIN' | 'ASSISTANT';
}

export interface Context {
  request?: Request;
  actor?: Actor;
}

interface ItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
}

interface PaymentInput {
  paymentMethod: PaymentMethod;
  amount: number;
  reference?: string | null;
}

function audit(input: {
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  context: Context;
}): void {
  void recordAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeState: input.beforeState as never,
    afterState: input.afterState as never,
    request: input.context.request,
    userId: input.context.actor?.id,
  });
}

function decimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(String(value));
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function defaultPriceFor(
  product: { retailPrice: Prisma.Decimal; wholesalePrice: Prisma.Decimal },
  saleType: 'RETAIL' | 'WHOLESALE',
): Prisma.Decimal {
  return saleType === 'WHOLESALE' ? decimal(product.wholesalePrice) : decimal(product.retailPrice);
}

interface PricedLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  priceOverridden: boolean;
}

/**
 * Server-side pricing. Never trusts client totals: resolves each product,
 * applies the default price for the sale type unless an override was
 * requested (ADMIN-only, audited), and recomputes every total with Decimal
 * arithmetic.
 */
async function priceLines(
  tx: Tx,
  items: ItemInput[],
  saleType: 'RETAIL' | 'WHOLESALE',
  actorRole: 'ADMIN' | 'ASSISTANT' | undefined,
): Promise<{ lines: PricedLine[]; subtotal: Prisma.Decimal }> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true, status: true, retailPrice: true, wholesalePrice: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines: PricedLine[] = [];
  let subtotal = decimal(0);

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) throw ApiError.notFound(`Product ${item.productId} not found`);
    if (product.status !== ProductStatus.ACTIVE) {
      throw new ApiError(409, 'PRODUCT_INACTIVE', `Product ${product.sku} is not active`);
    }

    const fallback = defaultPriceFor(product, saleType);
    const overridden = item.unitPrice !== undefined && !decimal(item.unitPrice).equals(fallback);
    if (overridden && actorRole !== 'ADMIN') {
      throw new ApiError(
        403,
        'PRICE_OVERRIDE_FORBIDDEN',
        'Only an administrator may override the selling price',
      );
    }
    const unitPrice = overridden ? decimal(item.unitPrice!) : fallback;

    const discount = decimal(item.discount ?? 0);
    const gross = unitPrice.mul(item.quantity);
    const lineTotal = gross.sub(discount);
    if (lineTotal.isNegative()) {
      throw new ApiError(
        400,
        'INVALID_DISCOUNT',
        `Discount on ${product.sku} exceeds the line amount`,
      );
    }

    subtotal = subtotal.add(lineTotal);
    lines.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: item.quantity,
      unitPrice,
      discount,
      lineTotal,
      priceOverridden: overridden,
    });
  }

  return { lines, subtotal };
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/**
 * Creates a completed sale atomically:
 *   document number -> sale -> items -> inventory deduction (frozen COGS)
 *   -> payment allocations -> customer credit charge -> (audit after commit).
 *
 * Stock rows are locked in deterministic (productId) order to avoid
 * deadlocks between concurrent multi-item sales. Any failure rolls back
 * everything — there is no partially committed sale.
 */
export async function createSale(
  body: {
    items: ItemInput[];
    customerId?: string | null;
    saleType?: 'RETAIL' | 'WHOLESALE';
    discount?: number;
    notes?: string | null;
    payments: PaymentInput[];
  },
  context: Context,
) {
  const saleType = body.saleType ?? 'RETAIL';
  const saleDiscount = decimal(body.discount ?? 0);

  // ---- Validation phase (no writes) --------------------------------------
  const priced = await prisma.$transaction(async (tx) => priceLines(tx, body.items, saleType, context.actor?.role));
  const { lines, subtotal } = priced;

  if (saleDiscount.greaterThan(subtotal)) {
    throw new ApiError(400, 'INVALID_DISCOUNT', 'Sale discount exceeds the sale subtotal');
  }
  const total = subtotal.sub(saleDiscount);

  const allocations = body.payments.map((payment) => ({
    ...payment,
    amountDecimal: decimal(payment.amount),
  }));
  const allocated = allocations.reduce((sum, p) => sum.add(p.amountDecimal), decimal(0));
  if (!allocated.equals(total)) {
    throw new ApiError(
      400,
      'PAYMENT_MISMATCH',
      `Payment allocations (${allocated.toFixed(2)}) must equal the sale total (${total.toFixed(2)})`,
    );
  }

  const creditAllocations = allocations.filter((p) => p.paymentMethod === PaymentMethod.CREDIT);
  const customerId = body.customerId ?? null;
  if (creditAllocations.length > 0 && !customerId) {
    throw new ApiError(
      400,
      'CUSTOMER_REQUIRED_FOR_CREDIT',
      'A registered customer is required for credit sales',
    );
  }

  // ---- Transactional phase ----------------------------------------------
  const result = await prisma.$transaction(async (tx) => {
    const saleNumber = await nextDocumentNumber(tx, DocumentType.SALE);

    if (customerId) {
      const customer = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw ApiError.notFound('Customer not found');
      if (customer.status !== 'ACTIVE') {
        throw new ApiError(409, 'CUSTOMER_INACTIVE', 'Customer is not active');
      }
    }

    const sale = await tx.sale.create({
      data: {
        saleNumber,
        customerId,
        saleType,
        status: SaleStatus.COMPLETED,
        subtotal,
        discount: saleDiscount,
        totalAmount: total,
        notes: body.notes ?? null,
        createdById: context.actor!.id,
      },
    });

    // Deterministic lock order across concurrent sales.
    const orderedLines = [...lines].sort((a, b) => a.productId.localeCompare(b.productId));

    let cogsTotal = decimal(0);
    for (const line of orderedLines) {
      // Deduct stock first: locks the row, verifies availability, freezes the
      // weighted-average cost for COGS. Rolls back with the sale on failure.
      const movement = await decreaseStockTx(tx, {
        productId: line.productId,
        quantity: line.quantity,
        type: 'SALE',
        createdById: context.actor!.id,
        note: `Sold on ${saleNumber}`,
      });

      const item = await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          lineTotal: line.lineTotal,
          unitCost: movement.unitCost,
          lineCost: movement.unitCost.mul(line.quantity),
        },
      });
      cogsTotal = cogsTotal.add(item.lineCost);

      // Link the ledger entry to the concrete sale item.
      await tx.inventoryTransaction.update({
        where: { id: movement.transactionId },
        data: { referenceId: item.id },
      });
    }

    for (const allocation of allocations) {
      await tx.payment.create({
        data: {
          saleId: sale.id,
          paymentMethod: allocation.paymentMethod,
          amount: allocation.amountDecimal,
          reference: allocation.reference ?? null,
          createdById: context.actor!.id,
        },
      });
    }

    // Charge credit portions against the customer's account (limit enforced
    // server-side under the account row lock).
    let creditBalanceAfter: Prisma.Decimal | null = null;
    for (const allocation of creditAllocations) {
      creditBalanceAfter = await chargeCreditTx(tx, {
        customerId: customerId!,
        amount: allocation.amountDecimal,
        saleNumber,
      });
    }

    return { sale, cogsTotal, creditBalanceAfter };
  });

  audit({
    action: AUDIT.SALE_CREATED,
    entityType: 'Sale',
    entityId: result.sale.id,
    afterState: {
      saleNumber: result.sale.saleNumber,
      total: Number(total),
      discount: Number(saleDiscount),
      cogs: Number(result.cogsTotal),
      hasPriceOverride: lines.some((line) => line.priceOverridden),
      creditCharged: creditAllocations.reduce((sum, p) => sum.add(p.amountDecimal), decimal(0)).toNumber(),
      creditBalanceAfter: result.creditBalanceAfter ? Number(result.creditBalanceAfter) : null,
    },
    context,
  });

  return buildSaleDetail(await fetchSale(result.sale.id));
}

async function fetchSale(saleId: string) {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    include: {
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      payments: true,
      customer: { select: { id: true, name: true, phone: true, type: true } },
      createdBy: { select: { id: true, fullName: true } },
      returns: { select: { id: true, returnNumber: true, status: true, totalAmount: true } },
    },
  });
  if (!sale) throw ApiError.notFound('Sale not found');
  return sale;
}

/** Serializes Decimals for JSON. Cost fields are stripped for ASSISTANT. */
export function buildSaleDetail(sale: Awaited<ReturnType<typeof fetchSale>>, includeFinancials = true) {
  const paid = sale.payments
    .filter((p) => p.paymentMethod !== PaymentMethod.CREDIT)
    .reduce((sum, p) => sum.add(p.amount), decimal(0));
  const creditPortion = sale.payments
    .filter((p) => p.paymentMethod === PaymentMethod.CREDIT)
    .reduce((sum, p) => sum.add(p.amount), decimal(0));

  const base = {
    id: sale.id,
    saleNumber: sale.saleNumber,
    customerId: sale.customerId,
    customer: sale.customer,
    saleType: sale.saleType,
    status: sale.status,
    subtotal: sale.subtotal.toFixed(2),
    discount: sale.discount.toFixed(2),
    totalAmount: sale.totalAmount.toFixed(2),
    notes: sale.notes,
    createdAt: sale.createdAt,
    createdBy: sale.createdBy,
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      sku: item.product.sku,
      name: item.product.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toFixed(2),
      discount: item.discount.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
      ...(includeFinancials
        ? { unitCost: item.unitCost.toFixed(2), lineCost: item.lineCost.toFixed(2) }
        : {}),
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      paymentMethod: payment.paymentMethod,
      amount: payment.amount.toFixed(2),
      reference: payment.reference,
      paidAt: payment.paidAt,
    })),
    returns: sale.returns,
    paidAmount: paid.toFixed(2),
    creditAmount: creditPortion.toFixed(2),
  };

  if (!includeFinancials) return base;

  const cogs = sale.items.reduce((sum, item) => sum.add(item.lineCost), decimal(0));
  const revenue = sale.items.reduce((sum, item) => sum.add(item.lineTotal), decimal(0)).sub(sale.discount);
  return {
    ...base,
    cogs: cogs.toFixed(2),
    grossProfit: revenue.sub(cogs).toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getSale(saleId: string, viewerRole: 'ADMIN' | 'ASSISTANT') {
  const sale = await fetchSale(saleId);
  return buildSaleDetail(sale, viewerRole === 'ADMIN');
}

export async function listSales(
  query: {
    q?: string;
    customerId?: string;
    status?: 'COMPLETED' | 'VOID';
    saleType?: 'RETAIL' | 'WHOLESALE';
    paymentMethod?: PaymentMethod;
    createdById?: string;
    from?: string;
    to?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  },
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const where: Prisma.SaleWhereInput = {};
  if (query.q) where.saleNumber = { contains: query.q, mode: 'insensitive' };
  if (query.customerId) where.customerId = query.customerId;
  if (query.status) where.status = query.status;
  if (query.saleType) where.saleType = query.saleType;
  if (query.createdById) where.createdById = query.createdById;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }
  if (query.paymentMethod) {
    where.payments = { some: { paymentMethod: query.paymentMethod } };
  }

  const sortBy = query.sortBy ?? 'createdAt';

  const [totalItems, rows] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ [sortBy]: query.sortOrder ?? 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = rows.map((sale) => ({
    id: sale.id,
    saleNumber: sale.saleNumber,
    customerId: sale.customerId,
    customerName: sale.customer?.name ?? null,
    saleType: sale.saleType,
    status: sale.status,
    totalAmount: sale.totalAmount.toFixed(2),
    discount: sale.discount.toFixed(2),
    itemCount: sale._count.items,
    createdBy: sale.createdBy,
    createdAt: sale.createdAt,
  }));

  return paginate(items, page, pageSize, totalItems);
}

// ---------------------------------------------------------------------------
// Voiding
// ---------------------------------------------------------------------------

/**
 * Voids a sale (ADMIN-only, route-enforced). Atomically:
 *   - restores every sold item to inventory at its frozen historical cost
 *     (ledger type ADJUSTMENT referencing the sale),
 *   - reverses CREDIT portions against the customer's account (clamped at a
 *     zero balance; any uncollectable remainder is reported as refundDue for
 *     manual settlement — the customer may already have paid part of it),
 *   - marks the sale VOID with the reason appended to its notes.
 *
 * Cash/mobile-money refunds are settled physically by the shop; the audit
 * trail records the full financial picture of the void.
 */
export async function voidSale(
  saleId: string,
  reason: string,
  context: Context,
) {
  const result = await prisma.$transaction(async (tx) => {
    // Lock the sale row to prevent concurrent voids from both seeing COMPLETED
    // and double-restoring stock / double-reversing credit.
    await tx.$queryRaw`SELECT id FROM "sales" WHERE id = ${saleId} FOR UPDATE`;
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { items: true, payments: true },
    });
    if (!sale) throw ApiError.notFound('Sale not found');
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new ApiError(409, 'SALE_ALREADY_VOIDED', 'Sale has already been voided');
    }

    // Restore stock in deterministic order (same ordering as creation).
    const orderedItems = [...sale.items].sort((a, b) => a.productId.localeCompare(b.productId));
    for (const item of orderedItems) {
      await increaseStockTx(tx, {
        productId: item.productId,
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        type: 'ADJUSTMENT',
        referenceId: sale.id,
        note: `Void of ${sale.saleNumber}: ${reason}`,
        createdById: context.actor!.id,
      });
    }

    // Reverse credit portions.
    let refundDue = decimal(0);
    const creditPayments = sale.payments.filter((p) => p.paymentMethod === PaymentMethod.CREDIT);
    if (creditPayments.length > 0 && sale.customerId) {
      const creditTotal = creditPayments.reduce((sum, p) => sum.add(p.amount), decimal(0));
      const rows = await tx.$queryRaw<Array<{ id: string; outstandingBalance: Prisma.Decimal | string }>>(
        Prisma.sql`
          SELECT "id", "outstandingBalance" FROM "customer_credit_accounts"
          WHERE "customerId" = ${sale.customerId}
          FOR UPDATE
        `,
      );
      if (rows[0]) {
        const balance = decimal(rows[0].outstandingBalance);
        const reversal = creditTotal.lessThanOrEqualTo(balance) ? creditTotal : balance;
        refundDue = creditTotal.sub(reversal);
        await tx.customerCreditAccount.update({
          where: { id: rows[0].id },
          data: { outstandingBalance: balance.sub(reversal) },
        });
      }
    }

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: SaleStatus.VOID,
        notes: `${sale.notes ? `${sale.notes} | ` : ''}[VOIDED ${new Date().toISOString()} by ${context.actor!.id}] ${reason}`,
      },
    });

    return { sale: updated, refundDue, creditReversed: creditPayments.reduce((sum, p) => sum.add(p.amount), decimal(0)) };
  });

  audit({
    action: AUDIT.SALE_VOIDED,
    entityType: 'Sale',
    entityId: result.sale.id,
    beforeState: { status: SaleStatus.COMPLETED },
    afterState: {
      status: SaleStatus.VOID,
      reason,
      creditReversed: Number(result.creditReversed),
      refundDue: Number(result.refundDue),
    },
    context,
  });

  return {
    sale: { id: result.sale.id, saleNumber: result.sale.saleNumber, status: result.sale.status },
    creditReversed: result.creditReversed.toFixed(2),
    refundDue: result.refundDue.toFixed(2),
  };
}
