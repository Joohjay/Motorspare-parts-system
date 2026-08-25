import {
  CreditAccountStatus,
  DocumentType,
  PaymentMethod,
  PurchaseReturnStatus,
  PurchaseStatus,
  Prisma,
} from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { nextDocumentNumber } from '../utils/documentNumber.js';
import { paginate } from '../utils/pagination.js';
import { decreaseStockTx, increaseStockTx } from './inventoryService.js';

export interface Actor {
  id: string;
}

export interface Context {
  request?: Request;
  actor?: Actor;
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

interface ReturnItemInput {
  purchaseItemId: string;
  quantity: number;
}

interface CreateInput {
  items: ReturnItemInput[];
  reason: string;
  settlement: 'SUPPLIER_CREDIT' | 'REFUND' | 'NONE';
  refundMethod?: PaymentMethod;
  refundReference?: string | null;
}

/**
 * Creates a COMPLETED purchase return atomically (ADMIN-only at the route):
 *
 *   lock purchase row -> validate returnable quantities -> document number
 *   -> return + items (frozen unit costs from the purchase lines)
 *   -> inventory reduction via InventoryService (weighted average, ledger
 *      row with balanceAfter, idempotent low-stock notifications)
 *   -> supplier settlement:
 *        SUPPLIER_CREDIT — reduces the supplier credit account's outstanding
 *          balance under a row lock, clamped at zero; any remainder is owed
 *          back by the supplier and reported as `refundDue`.
 *        REFUND — records the refund method/reference for the full amount.
 *        NONE — no immediate settlement; the full amount is owed by the
 *          supplier (`refundDue`).
 *   -> audit after commit.
 *
 * Costing: inventory leaves at the CURRENT weighted-average cost (decreasing
 * stock never changes the average), while the supplier is settled at each
 * line's FROZEN purchase unit cost. The return item stores that frozen cost;
 * any difference between frozen and current average is a realized gain/loss
 * inherent to weighted-average costing and is intentionally not amortized.
 */
export async function createPurchaseReturn(
  purchaseId: string,
  body: CreateInput,
  context: Context,
) {
  const result = await prisma.$transaction(async (tx) => {
    // Serialize concurrent returns against the same purchase.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "purchases" WHERE "id" = ${purchaseId} FOR UPDATE`,
    );
    if (!locked[0]) throw ApiError.notFound('Purchase not found');

    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: { items: true },
    });
    if (purchase.status !== PurchaseStatus.COMPLETED) {
      throw new ApiError(409, 'PURCHASE_NOT_ACTIVE', 'Returns can only be processed against completed purchases');
    }

    const itemsByLineId = new Map(purchase.items.map((item) => [item.id, item]));
    const requestedByLineId = new Map<string, number>();
    for (const item of body.items) {
      const line = itemsByLineId.get(item.purchaseItemId);
      if (!line || line.purchaseId !== purchaseId) {
        throw new ApiError(400, 'INVALID_PURCHASE_ITEM', 'Return item does not belong to this purchase');
      }
      requestedByLineId.set(item.purchaseItemId, (requestedByLineId.get(item.purchaseItemId) ?? 0) + item.quantity);
    }

    const previouslyReturned = await tx.purchaseReturnItem.groupBy({
      by: ['purchaseItemId'],
      where: {
        purchaseItemId: { in: [...requestedByLineId.keys()] },
        purchaseReturn: { status: PurchaseReturnStatus.COMPLETED },
      },
      _sum: { quantityReturned: true },
    });
    const returnedByLineId = new Map(
      previouslyReturned.map((row) => [row.purchaseItemId, row._sum.quantityReturned ?? 0]),
    );

    interface PlannedLine {
      purchaseItemId: string;
      productId: string;
      quantity: number;
      unitCost: Prisma.Decimal; // frozen historical cost paid to the supplier
      lineTotal: Prisma.Decimal;
    }

    const planned: PlannedLine[] = [];
    let totalAmount = decimal(0);

    for (const [lineId, requestedQty] of requestedByLineId) {
      const line = itemsByLineId.get(lineId)!;
      const accepted = line.quantityAccepted;
      const alreadyOut = returnedByLineId.get(lineId) ?? 0;
      const returnable = accepted - alreadyOut;
      if (requestedQty > returnable) {
        throw new ApiError(
          409,
          'RETURN_EXCEEDS_RETURNABLE',
          `Cannot return ${requestedQty} of ${line.productId}: only ${returnable} remain returnable`,
        );
      }
      const unitCost = decimal(line.unitCost);
      const lineTotal = unitCost.mul(requestedQty);
      totalAmount = totalAmount.add(lineTotal);
      planned.push({ purchaseItemId: lineId, productId: line.productId, quantity: requestedQty, unitCost, lineTotal });
    }

    const returnNumber = await nextDocumentNumber(tx, DocumentType.PURCHASE_RETURN);

    const purchaseReturn = await tx.purchaseReturn.create({
      data: {
        returnNumber,
        purchaseId,
        supplierId: purchase.supplierId,
        status: PurchaseReturnStatus.COMPLETED,
        reason: body.reason,
        totalAmount: totalAmount.toDecimalPlaces(2),
        createdById: context.actor!.id,
        creditedAmount: 0,
      },
    });

    for (const line of planned) {
      await tx.purchaseReturnItem.create({
        data: {
          purchaseReturnId: purchaseReturn.id,
          purchaseItemId: line.purchaseItemId,
          productId: line.productId,
          quantityReturned: line.quantity,
          unitCost: line.unitCost.toDecimalPlaces(2),
          lineTotal: line.lineTotal.toDecimalPlaces(2),
        },
      });
      // Stock leaves at the current weighted-average cost; the ledger row
      // freezes it and records balanceAfter. Low-stock notifications are
      // idempotent per product.
      await decreaseStockTx(tx, {
        productId: line.productId,
        quantity: line.quantity,
        type: 'PURCHASE_RETURN',
        referenceId: purchaseReturn.id,
        note: `Purchase return ${returnNumber}`,
        createdById: context.actor!.id,
      });
    }

    // Supplier settlement.
    let creditedAmount = decimal(0);
    if (body.settlement === 'SUPPLIER_CREDIT') {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; outstandingBalance: Prisma.Decimal | string }>>(
        Prisma.sql`
          SELECT "id", "status", "outstandingBalance"
          FROM "supplier_credit_accounts"
          WHERE "supplierId" = ${purchase.supplierId}
          FOR UPDATE
        `,
      );
      const accountRow = rows[0];
      if (!accountRow) {
        throw new ApiError(404, 'SUPPLIER_CREDIT_NOT_FOUND', 'Supplier has no credit account');
      }
      if (accountRow.status !== CreditAccountStatus.ACTIVE) {
        throw new ApiError(409, 'SUPPLIER_CREDIT_NOT_ACTIVE', 'Supplier credit account is not active');
      }
      const balance = decimal(accountRow.outstandingBalance);
      creditedAmount = totalAmount.greaterThan(balance) ? balance : totalAmount;
      if (creditedAmount.greaterThan(0)) {
        await tx.supplierCreditAccount.update({
          where: { id: accountRow.id },
          data: { outstandingBalance: balance.sub(creditedAmount) },
        });
      }
      await tx.purchaseReturn.update({
        where: { id: purchaseReturn.id },
        data: { creditedAmount: creditedAmount.toDecimalPlaces(2) },
      });
    }

    const refundDue = totalAmount.sub(creditedAmount).toDecimalPlaces(2);
    if (body.settlement === 'REFUND') {
      await tx.purchaseReturn.update({
        where: { id: purchaseReturn.id },
        data: {
          refundMethod: body.refundMethod ?? null,
          refundReference: body.refundReference ?? null,
        },
      });
    }

    return { purchaseReturn, totalAmount, creditedAmount, refundDue };
  });

  audit({
    action: AUDIT.PURCHASE_RETURN_CREATED,
    entityType: 'PurchaseReturn',
    entityId: result.purchaseReturn.id,
    afterState: {
      returnNumber: result.purchaseReturn.returnNumber,
      purchaseId,
      total: Number(result.totalAmount),
      creditedToSupplierAccount: Number(result.creditedAmount),
      refundDueFromSupplier: Number(result.refundDue),
      settlement: body.settlement,
    },
    context,
  });

  if (body.settlement === 'REFUND') {
    audit({
      action: AUDIT.SUPPLIER_REFUND_RECORDED,
      entityType: 'PurchaseReturn',
      entityId: result.purchaseReturn.id,
      afterState: {
        returnNumber: result.purchaseReturn.returnNumber,
        amount: Number(result.totalAmount),
        method: body.refundMethod ?? null,
        reference: body.refundReference ?? null,
      },
      context,
    });
  }

  return getPurchaseReturn(result.purchaseReturn.id);
}

/**
 * Cancels (voids) a completed purchase return — ADMIN-only corrective
 * operation. Restores stock at the frozen return cost (ledger type
 * ADJUSTMENT referencing the return) and reverses any supplier credit
 * adjustment clamped at a zero balance with any remainder reported as
 * `refundRecovered`. Completed returns are otherwise immutable.
 */
export async function cancelPurchaseReturn(returnId: string, context: Context) {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "purchase_returns" WHERE "id" = ${returnId} FOR UPDATE`,
    );
    if (!locked[0]) throw ApiError.notFound('Purchase return not found');

    const purchaseReturn = await tx.purchaseReturn.findUniqueOrThrow({
      where: { id: returnId },
      include: { items: true },
    });
    if (purchaseReturn.status !== PurchaseReturnStatus.COMPLETED) {
      throw new ApiError(409, 'PURCHASE_RETURN_NOT_ACTIVE', 'Only completed returns can be cancelled');
    }

    for (const item of purchaseReturn.items) {
      await increaseStockTx(tx, {
        productId: item.productId,
        quantity: item.quantityReturned,
        unitCost: Number(decimal(item.unitCost)),
        type: 'ADJUSTMENT',
        referenceId: purchaseReturn.id,
        note: `Reversal of purchase return ${purchaseReturn.returnNumber}`,
        createdById: context.actor!.id,
      });
    }

    let restoredAmount = decimal(0);
    let unrecoverableAmount = decimal(0);
    const credited = decimal(purchaseReturn.creditedAmount);
    if (credited.greaterThan(0)) {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; outstandingBalance: Prisma.Decimal | string }>>(
        Prisma.sql`
          SELECT "id", "status", "outstandingBalance"
          FROM "supplier_credit_accounts"
          WHERE "supplierId" = ${purchaseReturn.supplierId}
          FOR UPDATE
        `,
      );
      const accountRow = rows[0];
      if (accountRow && accountRow.status === CreditAccountStatus.ACTIVE) {
        const balance = decimal(accountRow.outstandingBalance);
        // Re-charge what was credited; if the balance was since paid down we
        // can only restore up to the available headroom — no negative
        // balances ever. Any shortfall is money the shop effectively kept.
        restoredAmount = credited.greaterThan(balance) ? balance : credited;
        if (restoredAmount.greaterThan(0)) {
          await tx.supplierCreditAccount.update({
            where: { id: accountRow.id },
            data: { outstandingBalance: balance.add(restoredAmount) },
          });
        }
        unrecoverableAmount = credited.sub(restoredAmount).toDecimalPlaces(2);
      } else {
        unrecoverableAmount = credited.toDecimalPlaces(2);
      }
    }

    const updated = await tx.purchaseReturn.update({
      where: { id: returnId },
      data: { status: PurchaseReturnStatus.CANCELLED },
    });

    return { purchaseReturn: updated, credited, restoredAmount, unrecoverableAmount };
  });

  audit({
    action: AUDIT.PURCHASE_RETURN_CANCELLED,
    entityType: 'PurchaseReturn',
    entityId: result.purchaseReturn.id,
    beforeState: { status: PurchaseReturnStatus.COMPLETED },
    afterState: {
      status: PurchaseReturnStatus.CANCELLED,
      returnNumber: result.purchaseReturn.returnNumber,
      creditRestored: Number(result.restoredAmount),
      creditUnrecoverable: Number(result.unrecoverableAmount),
    },
    context,
  });

  return {
    purchaseReturn: { id: result.purchaseReturn.id, returnNumber: result.purchaseReturn.returnNumber, status: result.purchaseReturn.status },
    creditRestored: result.restoredAmount.toFixed(2),
    creditUnrecoverable: result.unrecoverableAmount.toFixed(2),
  };
}

export async function getPurchaseReturn(returnId: string) {
  const purchaseReturn = await prisma.purchaseReturn.findUnique({
    where: { id: returnId },
    include: {
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      purchase: { select: { id: true, purchaseNumber: true, invoiceReference: true, status: true } },
      supplier: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  if (!purchaseReturn) throw ApiError.notFound('Purchase return not found');

  return {
    ...purchaseReturn,
    totalAmount: purchaseReturn.totalAmount.toFixed(2),
    creditedAmount: purchaseReturn.creditedAmount.toFixed(2),
    refundDue: decimal(purchaseReturn.totalAmount).sub(decimal(purchaseReturn.creditedAmount)).toFixed(2),
    items: purchaseReturn.items.map((item) => ({
      id: item.id,
      purchaseItemId: item.purchaseItemId,
      productId: item.productId,
      sku: item.product.sku,
      name: item.product.name,
      quantityReturned: item.quantityReturned,
      unitCost: item.unitCost.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
    })),
  };
}

export async function listPurchaseReturns(
  query: {
    q?: string;
    purchaseId?: string;
    supplierId?: string;
    status?: PurchaseReturnStatus;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  },
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const where: Prisma.PurchaseReturnWhereInput = {};
  if (query.q) where.returnNumber = { contains: query.q, mode: 'insensitive' };
  if (query.purchaseId) where.purchaseId = query.purchaseId;
  if (query.supplierId) where.supplierId = query.supplierId;
  if (query.status) where.status = query.status;

  const sortBy = query.sortBy ?? 'returnDate';

  const [totalItems, rows] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({
      where,
      include: {
        purchase: { select: { purchaseNumber: true } },
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ [sortBy]: query.sortOrder ?? 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = rows.map((purchaseReturn) => ({
    id: purchaseReturn.id,
    returnNumber: purchaseReturn.returnNumber,
    purchaseNumber: purchaseReturn.purchase.purchaseNumber,
    supplierId: purchaseReturn.supplierId,
    supplierName: purchaseReturn.supplier.name,
    status: purchaseReturn.status,
    totalAmount: purchaseReturn.totalAmount.toFixed(2),
    creditedAmount: purchaseReturn.creditedAmount.toFixed(2),
    itemCount: purchaseReturn._count.items,
    createdBy: purchaseReturn.createdBy,
    returnDate: purchaseReturn.returnDate,
  }));

  return paginate(items, page, pageSize, totalItems);
}
