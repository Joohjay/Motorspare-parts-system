import {
  CreditAccountStatus,
  DocumentType,
  InventoryTransactionType,
  Prisma,
  PurchaseOrderStatus,
  PurchasePaymentStatus,
  PurchaseStatus,
} from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { nextDocumentNumber } from '../utils/documentNumber.js';
import { orderBy, paginate } from '../utils/pagination.js';
import { increaseStockTx } from './inventoryService.js';

type Tx = Prisma.TransactionClient;

interface Actor {
  id: string;
}

interface Context {
  request?: Request;
  actor?: Actor;
}

export interface ReceiveItemInput {
  purchaseOrderItemId?: string;
  productId: string;
  quantityReceived: number;
  quantityDamaged?: number;
  quantityMissing?: number;
  unitCost?: number;
  quantityOrdered?: number;
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

function assertCounts(received: number, damaged: number, missing: number): void {
  if (damaged < 0 || missing < 0) {
    throw new ApiError(400, 'INVALID_RECEIVING_QUANTITY', 'Damaged/missing quantities cannot be negative');
  }
  if (received <= 0) {
    throw new ApiError(400, 'INVALID_RECEIVING_QUANTITY', 'Received quantity must be at least 1');
  }
  if (damaged + missing > received) {
    throw new ApiError(
      400,
      'INVALID_RECEIVING_QUANTITY',
      'Damaged and missing units cannot exceed the received quantity',
    );
  }
}

async function lockPurchaseOrder(tx: Tx, purchaseOrderId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "purchase_orders"
      WHERE "id" = ${purchaseOrderId}
      FOR UPDATE
    `,
  );
  if (!rows[0]) {
    throw new ApiError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listPurchases(query: {
  q?: string;
  supplierId?: string;
  purchaseOrderId?: string;
  status?: PurchaseStatus;
  paymentStatus?: PurchasePaymentStatus;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const where = {
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.from ? { receivedAt: { gte: new Date(query.from) } } : {}),
    ...(query.to ? { receivedAt: { lte: new Date(query.to) } } : {}),
    ...(query.q
      ? {
          OR: [
            { purchaseNumber: { contains: query.q, mode: 'insensitive' as const } },
            { invoiceReference: { contains: query.q, mode: 'insensitive' as const } },
            { supplier: { name: { contains: query.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [totalItems, items] = await Promise.all([
    prisma.purchase.count({ where }),
    prisma.purchase.findMany({
      where,
      orderBy: orderBy(query.sortBy ?? 'receivedAt', query.sortOrder ?? 'desc', {
        purchaseNumber: 'purchaseNumber',
        receivedAt: 'receivedAt',
        totalAmount: 'totalAmount',
        status: 'status',
        paymentStatus: 'paymentStatus',
        createdAt: 'createdAt',
      }),
      include: {
        supplier: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, orderNumber: true } },
        _count: { select: { items: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(items, page, pageSize, totalItems);
}

export async function getPurchase(id: string) {
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, status: true } },
      purchaseOrder: { select: { id: true, orderNumber: true, status: true } },
      creditAccount: { select: { id: true, outstandingBalance: true, status: true } },
      createdBy: { select: { id: true, fullName: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true, status: true } },
          purchaseOrderItem: { select: { id: true, quantityOrdered: true } },
        },
      },
      returns: {
        select: { id: true, returnNumber: true, status: true, totalAmount: true, returnDate: true },
        orderBy: { returnDate: 'desc' },
      },
      creditPayments: {
        select: { id: true, amount: true, paymentMethod: true, reference: true, paidAt: true },
        orderBy: { paidAt: 'desc' },
      },
    },
  });
  if (!purchase) {
    throw new ApiError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  }
  return purchase;
}

// ---------------------------------------------------------------------------
// Receiving
// ---------------------------------------------------------------------------

/**
 * Receives goods — against a purchase order or as a direct purchase.
 *
 * Rules enforced:
 *  - Ordered ≠ received ≠ accepted ≠ stock. Only `quantityAccepted` enters
 *    inventory, and it does so through InventoryService (atomic, same tx).
 *  - Partial receiving is allowed; over-receiving is rejected.
 *  - Concurrent receives on the same PO serialize on a row lock, so the
 *    "remaining" check is race-free.
 *  - When the supplier has an ACTIVE credit account the purchase is charged to
 *    credit (outstanding balance increases) in the same transaction.
 */
export async function createPurchase(
  body: {
    purchaseOrderId?: string;
    supplierId?: string;
    invoiceReference?: string | null;
    notes?: string | null;
    receivedAt?: string;
    items: ReceiveItemInput[];
  },
  context: Context,
) {
  const supplierId = await resolveSupplier(body, context);

  interface ResolvedLine {
    purchaseOrderItemId: string | null;
    productId: string;
    quantityOrdered: number;
    quantityReceived: number;
    quantityDamaged: number;
    quantityMissing: number;
    unitCost: number;
  }

  const result = await prisma.$transaction(async (tx) => {
    let purchaseOrderId: string | null = null;
    let resolved: ResolvedLine[];

    if (body.purchaseOrderId) {
      await lockPurchaseOrder(tx, body.purchaseOrderId);
      const order = await tx.purchaseOrder.findUnique({
        where: { id: body.purchaseOrderId },
        include: {
          items: {
            include: {
              purchaseItems: { select: { quantityReceived: true } },
            },
          },
        },
      });
      if (!order) {
        throw new ApiError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
      }
      if (
        order.status !== PurchaseOrderStatus.PENDING &&
        order.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED
      ) {
        if (order.status === PurchaseOrderStatus.RECEIVED) {
          throw new ApiError(409, 'PURCHASE_ORDER_ALREADY_RECEIVED', 'Purchase order is already fully received');
        }
        throw new ApiError(409, 'INVALID_PURCHASE_ORDER_STATUS', `Cannot receive a purchase order in status ${order.status}`);
      }
      purchaseOrderId = order.id;

      // Ordered quantity and unit cost are frozen on the PO line — receiving
      // never invents them. Only the physical counts come from the request.
      const orderedByItem = new Map(order.items.map((i) => [i.id, i]));
      resolved = body.items.map((line) => {
        if (!line.purchaseOrderItemId) {
          throw new ApiError(400, 'INVALID_RECEIVING_QUANTITY', 'Each receiving line against a purchase order must reference a PO line');
        }
        const poLine = orderedByItem.get(line.purchaseOrderItemId);
        if (!poLine) {
          throw new ApiError(404, 'PURCHASE_ORDER_NOT_FOUND', `Purchase order line ${line.purchaseOrderItemId} not found`);
        }
        if (line.productId !== poLine.productId) {
          throw new ApiError(400, 'INVALID_RECEIVING_QUANTITY', 'Received product does not match the purchase order line');
        }
        const damaged = line.quantityDamaged ?? 0;
        const missing = line.quantityMissing ?? 0;
        assertCounts(line.quantityReceived, damaged, missing);
        const receivedSoFar = poLine.purchaseItems.reduce((sum, pi) => sum + pi.quantityReceived, 0);
        const remaining = poLine.quantityOrdered - receivedSoFar;
        if (line.quantityReceived > remaining) {
          throw new ApiError(
            409,
            'RECEIVED_QUANTITY_EXCEEDS_ORDERED',
            `Received quantity exceeds the remaining ordered quantity for ${poLine.productId} (remaining ${remaining})`,
          );
        }
        return {
          purchaseOrderItemId: poLine.id,
          productId: poLine.productId,
          quantityOrdered: poLine.quantityOrdered,
          quantityReceived: line.quantityReceived,
          quantityDamaged: damaged,
          quantityMissing: missing,
          unitCost: Number(poLine.unitCost),
        };
      });
    } else {
      resolved = body.items.map((line) => {
        const damaged = line.quantityDamaged ?? 0;
        const missing = line.quantityMissing ?? 0;
        assertCounts(line.quantityReceived, damaged, missing);
        if (line.unitCost === undefined || line.quantityOrdered === undefined) {
          throw new ApiError(
            400,
            'INVALID_RECEIVING_QUANTITY',
            'Direct purchases require a unit cost and ordered quantity per line',
          );
        }
        return {
          purchaseOrderItemId: null,
          productId: line.productId,
          quantityOrdered: line.quantityOrdered,
          quantityReceived: line.quantityReceived,
          quantityDamaged: damaged,
          quantityMissing: missing,
          unitCost: line.unitCost,
        };
      });
    }

    const purchaseNumber = await nextDocumentNumber(tx, DocumentType.PURCHASE);
    const purchase = await tx.purchase.create({
      data: {
        purchaseNumber,
        purchaseOrderId,
        supplierId,
        invoiceReference: body.invoiceReference ?? null,
        status: PurchaseStatus.COMPLETED,
        paymentStatus: PurchasePaymentStatus.UNPAID,
        receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
        totalAmount: new Prisma.Decimal(0),
        notes: body.notes ?? null,
        createdById: context.actor!.id,
      },
    });

    let totalAmount = new Prisma.Decimal(0);

    for (const line of resolved) {
      const accepted = line.quantityReceived - line.quantityDamaged - line.quantityMissing;

      await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          purchaseOrderItemId: line.purchaseOrderItemId,
          productId: line.productId,
          quantityOrdered: line.quantityOrdered,
          quantityReceived: line.quantityReceived,
          quantityDamaged: line.quantityDamaged,
          quantityMissing: line.quantityMissing,
          quantityAccepted: accepted,
          unitCost: new Prisma.Decimal(line.unitCost),
          lineTotal: new Prisma.Decimal(accepted).mul(new Prisma.Decimal(line.unitCost)).toDecimalPlaces(2),
        },
      });

      if (accepted > 0) {
        await increaseStockTx(tx, {
          productId: line.productId,
          quantity: accepted,
          unitCost: line.unitCost,
          type: InventoryTransactionType.PURCHASE,
          referenceId: purchase.id,
          note: `Purchase ${purchaseNumber} receiving`,
          createdById: context.actor!.id,
        });
      }
      totalAmount = totalAmount.add(new Prisma.Decimal(accepted).mul(new Prisma.Decimal(line.unitCost)));
    }

    let creditAccountId: string | null = null;
    if (totalAmount.greaterThan(0)) {
      const account = await tx.supplierCreditAccount.findUnique({
        where: { supplierId },
      });
      if (account && account.status === CreditAccountStatus.ACTIVE) {
        creditAccountId = account.id;
        await tx.supplierCreditAccount.update({
          where: { id: account.id },
          data: { outstandingBalance: new Prisma.Decimal(account.outstandingBalance).add(totalAmount) },
        });
      }
    }

    const updated = await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        totalAmount: totalAmount.toDecimalPlaces(2),
        creditAccountId,
        paymentStatus: totalAmount.isZero()
          ? PurchasePaymentStatus.PAID
          : PurchasePaymentStatus.UNPAID,
      },
    });

    if (purchaseOrderId) {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: {
          items: {
            include: { purchaseItems: { select: { quantityReceived: true } } },
          },
        },
      });
      if (order) {
        const allFullyReceived = order.items.every(
          (item) =>
            item.purchaseItems.reduce((sum, pi) => sum + pi.quantityReceived, 0) >= item.quantityOrdered,
        );
        const nextStatus =
          order.status === PurchaseOrderStatus.CANCELLED
            ? order.status
            : allFullyReceived
              ? PurchaseOrderStatus.RECEIVED
              : PurchaseOrderStatus.PARTIALLY_RECEIVED;
        if (nextStatus !== order.status) {
          await tx.purchaseOrder.update({ where: { id: order.id }, data: { status: nextStatus } });
        }
      }
    }

    return { purchase: updated, totalAmount: totalAmount.toDecimalPlaces(2), creditAccountId };
  });

  audit({
    action: AUDIT.PURCHASE_CREATED,
    entityType: 'Purchase',
    entityId: result.purchase.id,
    afterState: {
      purchaseNumber: result.purchase.purchaseNumber,
      totalAmount: Number(result.totalAmount),
      creditAccountId: result.creditAccountId,
      items: body.items.length,
    },
    context,
  });

  return getPurchase(result.purchase.id);
}

async function resolveSupplier(
  body: { purchaseOrderId?: string; supplierId?: string },
  _context: Context,
): Promise<string> {
  if (body.purchaseOrderId) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: body.purchaseOrderId },
      select: { supplierId: true },
    });
    if (!order) {
      throw new ApiError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
    }
    return order.supplierId;
  }
  if (!body.supplierId) {
    throw new ApiError(
      400,
      'INVALID_RECEIVING_QUANTITY',
      'Direct purchases require a supplierId',
    );
  }
  const supplier = await prisma.supplier.findUnique({ where: { id: body.supplierId } });
  if (!supplier) {
    throw new ApiError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  }
  if (supplier.status !== 'ACTIVE') {
    throw new ApiError(409, 'SUPPLIER_INACTIVE', 'Cannot receive goods from an inactive supplier');
  }
  return supplier.id;
}