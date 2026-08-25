import { CreditAccountStatus, DocumentType, PaymentMethod, Prisma, SaleReturnStatus, SaleStatus } from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { paginate } from '../utils/pagination.js';
import { nextDocumentNumber } from '../utils/documentNumber.js';
import { increaseStockTx } from './inventoryService.js';
import { lockCreditAccount } from './customerCreditService.js';

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
  saleItemId: string;
  quantity: number;
  condition?: 'GOOD' | 'DAMAGED' | 'DEFECTIVE' | 'WRONG_ITEM' | 'OTHER';
}

/**
 * Processes a sales return atomically (ADMIN-only at the route):
 *
 *   document number -> return + items -> inventory restoration for GOOD
 *   units -> refund settlement (credit adjustment or money-back method)
 *   -> audit after commit.
 *
 * Refund math uses each sale item's EFFECTIVE unit price
 * (lineTotal / quantity) so line discounts propagate proportionally; a full
 * return therefore refunds exactly what was paid for the line. Historical
 * COGS is preserved: GOOD stock re-enters inventory at the original frozen
 * unitCost, which feeds back into the weighted-average cost.
 */
export async function createSaleReturn(
  saleId: string,
  body: {
    items: ReturnItemInput[];
    reason: string;
    creditAdjusted?: boolean;
    refundMethod?: PaymentMethod;
    refundReference?: string | null;
  },
  context: Context,
) {
  const result = await prisma.$transaction(async (tx) => {
    // Lock the sale row to prevent concurrent returns from exceeding returnable caps.
    await tx.$queryRaw`SELECT id FROM "sales" WHERE id = ${saleId} FOR UPDATE`;
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    if (!sale) throw ApiError.notFound('Sale not found');
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new ApiError(409, 'SALE_NOT_ACTIVE', 'Returns can only be processed against completed sales');
    }

    // Validate quantities against remaining returnable amounts.
    const itemsBySaleItemId = new Map(sale.items.map((item) => [item.id, item]));
    const requestedBySaleItemId = new Map<string, number>();
    for (const item of body.items) {
      const saleItem = itemsBySaleItemId.get(item.saleItemId);
      if (!saleItem || saleItem.saleId !== saleId) {
        throw new ApiError(400, 'INVALID_SALE_ITEM', 'Return item does not belong to this sale');
      }
      const alreadyRequested = requestedBySaleItemId.get(item.saleItemId) ?? 0;
      requestedBySaleItemId.set(item.saleItemId, alreadyRequested + item.quantity);
    }

    const previouslyReturned = await tx.saleReturnItem.groupBy({
      by: ['saleItemId'],
      where: {
        saleItemId: { in: [...requestedBySaleItemId.keys()] },
        saleReturn: { status: SaleReturnStatus.COMPLETED },
      },
      _sum: { quantityReturned: true },
    });
    const returnedBySaleItemId = new Map(
      previouslyReturned.map((row) => [row.saleItemId, row._sum.quantityReturned ?? 0]),
    );

    interface PlannedLine {
      saleItemId: string;
      productId: string;
      quantity: number;
      condition: 'GOOD' | 'DAMAGED' | 'DEFECTIVE' | 'WRONG_ITEM' | 'OTHER';
      unitPrice: Prisma.Decimal; // effective per-unit refund price
      lineTotal: Prisma.Decimal;
      unitCost: Prisma.Decimal; // frozen historical cost
    }

    const planned: PlannedLine[] = [];
    let totalAmount = decimal(0);

    for (const [saleItemId, requestedQty] of requestedBySaleItemId) {
      const saleItem = itemsBySaleItemId.get(saleItemId)!;
      const soldQty = saleItem.quantity;
      const alreadyOut = returnedBySaleItemId.get(saleItemId) ?? 0;
      const returnable = soldQty - alreadyOut;
      if (requestedQty > returnable) {
        throw new ApiError(
          409,
          'RETURN_EXCEEDS_RETURNABLE',
          `Cannot return ${requestedQty} of ${saleItem.productId}: only ${returnable} remain returnable`,
        );
      }

      // Effective per-unit price keeps line-discount proportions exact.
      const effectiveUnitPrice = decimal(saleItem.lineTotal).div(saleItem.quantity).toDecimalPlaces(2);
      const lineTotal = effectiveUnitPrice.mul(requestedQty);
      totalAmount = totalAmount.add(lineTotal);

      const firstMatchingInput = body.items.find((input) => input.saleItemId === saleItemId)!;
      planned.push({
        saleItemId,
        productId: saleItem.productId,
        quantity: requestedQty,
        condition: firstMatchingInput.condition ?? 'GOOD',
        unitPrice: effectiveUnitPrice,
        lineTotal,
        unitCost: decimal(saleItem.unitCost),
      });
    }

    const returnNumber = await nextDocumentNumber(tx, DocumentType.SALE_RETURN);

    const saleReturn = await tx.saleReturn.create({
      data: {
        returnNumber,
        saleId: sale.id,
        customerId: sale.customerId,
        status: SaleReturnStatus.COMPLETED,
        reason: body.reason,
        totalAmount,
        refundMethod: body.creditAdjusted ? null : (body.refundMethod ?? null),
        refundReference: body.refundReference ?? null,
        creditAdjusted: body.creditAdjusted ?? false,
        createdById: context.actor!.id,
      },
    });

    for (const line of planned) {
      const returnItem = await tx.saleReturnItem.create({
        data: {
          saleReturnId: saleReturn.id,
          saleItemId: line.saleItemId,
          productId: line.productId,
          quantityReturned: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          condition: line.condition,
        },
      });

      // Only sellable-condition stock returns to inventory, restored at the
      // ORIGINAL frozen cost so weighted-average costing stays consistent.
      if (line.condition === 'GOOD') {
        const movement = await increaseStockTx(tx, {
          productId: line.productId,
          quantity: line.quantity,
          unitCost: Number(line.unitCost),
          type: 'SALE_RETURN',
          createdById: context.actor!.id,
          note: `Customer return on ${returnNumber}`,
        });
        await tx.inventoryTransaction.update({
          where: { id: movement.transactionId },
          data: { referenceId: returnItem.id },
        });
      }
    }

    // Settlement.
    if (body.creditAdjusted) {
      if (!sale.customerId) {
        throw new ApiError(400, 'CUSTOMER_REQUIRED_FOR_CREDIT', 'The original sale has no customer to credit');
      }
      const account = await lockCreditAccount(tx, sale.customerId);
      if (account.status !== CreditAccountStatus.ACTIVE) {
        throw new ApiError(409, 'CUSTOMER_CREDIT_NOT_ACTIVE', 'Customer credit account is not active');
      }
      const balance = decimal(account.outstandingBalance);
      if (totalAmount.greaterThan(balance)) {
        throw new ApiError(
          409,
          'REFUND_EXCEEDS_BALANCE',
          `Credit adjustment of ${totalAmount.toFixed(2)} exceeds the outstanding balance of ${balance.toFixed(2)} — use a direct refund instead`,
        );
      }
      await tx.customerCreditAccount.update({
        where: { id: account.id },
        data: { outstandingBalance: balance.sub(totalAmount) },
      });
    }

    return { saleReturn, totalAmount };
  });

  audit({
    action: AUDIT.SALE_RETURN_CREATED,
    entityType: 'SaleReturn',
    entityId: result.saleReturn.id,
    afterState: {
      returnNumber: result.saleReturn.returnNumber,
      saleId,
      total: Number(result.totalAmount),
      creditAdjusted: result.saleReturn.creditAdjusted,
      refundMethod: result.saleReturn.refundMethod,
    },
    context,
  });

  return {
    ...result.saleReturn,
    totalAmount: result.totalAmount.toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getSaleReturn(returnId: string) {
  const saleReturn = await prisma.saleReturn.findUnique({
    where: { id: returnId },
    include: {
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      sale: { select: { id: true, saleNumber: true, saleType: true, status: true } },
      customer: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
  if (!saleReturn) throw ApiError.notFound('Return not found');

  return {
    ...saleReturn,
    totalAmount: saleReturn.totalAmount.toFixed(2),
    items: saleReturn.items.map((item) => ({
      id: item.id,
      saleItemId: item.saleItemId,
      productId: item.productId,
      sku: item.product.sku,
      name: item.product.name,
      quantityReturned: item.quantityReturned,
      unitPrice: item.unitPrice.toFixed(2),
      lineTotal: item.lineTotal.toFixed(2),
      condition: item.condition,
    })),
  };
}

export async function listSaleReturns(
  query: {
    q?: string;
    saleId?: string;
    customerId?: string;
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

  const where: Prisma.SaleReturnWhereInput = {};
  if (query.q) where.returnNumber = { contains: query.q, mode: 'insensitive' };
  if (query.saleId) where.saleId = query.saleId;
  if (query.customerId) where.customerId = query.customerId;
  if (query.from || query.to) {
    where.returnDate = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }

  const sortBy = query.sortBy ?? 'returnDate';

  const [totalItems, rows] = await Promise.all([
    prisma.saleReturn.count({ where }),
    prisma.saleReturn.findMany({
      where,
      include: {
        sale: { select: { saleNumber: true } },
        customer: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ [sortBy]: query.sortOrder ?? 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = rows.map((saleReturn) => ({
    id: saleReturn.id,
    returnNumber: saleReturn.returnNumber,
    saleNumber: saleReturn.sale.saleNumber,
    customerId: saleReturn.customerId,
    customerName: saleReturn.customer?.name ?? null,
    status: saleReturn.status,
    totalAmount: saleReturn.totalAmount.toFixed(2),
    creditAdjusted: saleReturn.creditAdjusted,
    refundMethod: saleReturn.refundMethod,
    itemCount: saleReturn._count.items,
    createdBy: saleReturn.createdBy,
    returnDate: saleReturn.returnDate,
  }));

  return paginate(items, page, pageSize, totalItems);
}
