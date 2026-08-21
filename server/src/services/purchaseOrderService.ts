import { DocumentType, Prisma, PurchaseOrderStatus, SupplierStatus } from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { nextDocumentNumber } from '../utils/documentNumber.js';
import { orderBy, paginate } from '../utils/pagination.js';

type Tx = Prisma.TransactionClient;

interface Actor {
  id: string;
}

interface Context {
  request?: Request;
  actor?: Actor;
}

export interface PurchaseOrderItemInput {
  productId: string;
  quantityOrdered: number;
  unitCost: number;
  notes?: string | null;
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

const ORDERABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.PENDING,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

function lineTotal(quantity: number, unitCost: number): Prisma.Decimal {
  return new Prisma.Decimal(quantity).mul(new Prisma.Decimal(unitCost)).toDecimalPlaces(2);
}

async function ensureOrder(id: string) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true, supplier: true },
  });
  if (!order) {
    throw new ApiError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }
  return order;
}

async function validateItems(items: PurchaseOrderItemInput[]): Promise<void> {
  const productIds = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, status: true },
  });
  const found = new Set(products.map((p) => p.id));
  for (const item of items) {
    if (!found.has(item.productId)) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', `Product ${item.productId} not found`);
    }
  }
  const inactive = products.find((p) => p.status !== 'ACTIVE');
  if (inactive) {
    throw new ApiError(409, 'PRODUCT_INACTIVE', 'Cannot order an inactive product');
  }
  if (items.length !== productIds.length) {
    throw new ApiError(400, 'DUPLICATE_PURCHASE_ORDER_ITEM', 'Duplicate product in purchase order items');
  }
}

async function writeItems(
  tx: Tx,
  orderId: string,
  items: PurchaseOrderItemInput[],
): Promise<Prisma.Decimal> {
  let total = new Prisma.Decimal(0);
  for (const item of items) {
    const line = lineTotal(item.quantityOrdered, item.unitCost);
    total = total.add(line);
    await tx.purchaseOrderItem.create({
      data: {
        purchaseOrderId: orderId,
        productId: item.productId,
        quantityOrdered: item.quantityOrdered,
        unitCost: new Prisma.Decimal(item.unitCost),
        lineTotal: line,
        notes: item.notes ?? null,
      },
    });
  }
  return total;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listPurchaseOrders(query: {
  q?: string;
  supplierId?: string;
  status?: PurchaseOrderStatus;
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
    ...(query.status ? { status: query.status } : {}),
    ...(query.from ? { orderDate: { gte: new Date(query.from) } } : {}),
    ...(query.to ? { orderDate: { lte: new Date(query.to) } } : {}),
    ...(query.q
      ? {
          OR: [
            { orderNumber: { contains: query.q, mode: 'insensitive' as const } },
            { supplier: { name: { contains: query.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [totalItems, items] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      orderBy: orderBy(query.sortBy ?? 'orderDate', query.sortOrder ?? 'desc', {
        orderNumber: 'orderNumber',
        orderDate: 'orderDate',
        totalAmount: 'totalAmount',
        status: 'status',
        createdAt: 'createdAt',
      }),
      include: {
        supplier: { select: { id: true, name: true } },
        _count: { select: { items: true, purchases: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(items, page, pageSize, totalItems);
}

export async function getPurchaseOrder(id: string) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, status: true } },
      createdBy: { select: { id: true, fullName: true } },
      items: {
        include: {
          product: { select: { id: true, sku: true, name: true, status: true } },
          purchaseItems: { select: { quantityReceived: true, quantityDamaged: true, quantityMissing: true, quantityAccepted: true, purchaseId: true } },
        },
      },
      purchases: {
        select: { id: true, purchaseNumber: true, status: true, paymentStatus: true, receivedAt: true, totalAmount: true },
        orderBy: { receivedAt: 'desc' },
      },
    },
  });
  if (!order) {
    throw new ApiError(404, 'PURCHASE_ORDER_NOT_FOUND', 'Purchase order not found');
  }

  const items = order.items.map((item) => ({
    ...item,
    received: item.purchaseItems.reduce((sum, pi) => sum + pi.quantityReceived, 0),
    remaining: item.quantityOrdered - item.purchaseItems.reduce((sum, pi) => sum + pi.quantityReceived, 0),
    purchaseItems: undefined,
  }));

  return { ...order, items };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createPurchaseOrder(
  body: {
    supplierId: string;
    orderDate?: string;
    expectedDelivery?: string | null;
    notes?: string | null;
    items: PurchaseOrderItemInput[];
  },
  context: Context,
) {
  const supplier = await prisma.supplier.findUnique({ where: { id: body.supplierId } });
  if (!supplier) {
    throw new ApiError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  }
  if (supplier.status !== SupplierStatus.ACTIVE) {
    throw new ApiError(409, 'SUPPLIER_INACTIVE', 'Cannot create a purchase order for an inactive supplier');
  }
  await validateItems(body.items);

  const order = await prisma.$transaction(async (tx) => {
    const orderNumber = await nextDocumentNumber(tx, DocumentType.PURCHASE_ORDER);
    const created = await tx.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: body.supplierId,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
        expectedDelivery: body.expectedDelivery ? new Date(body.expectedDelivery) : null,
        notes: body.notes ?? null,
        totalAmount: new Prisma.Decimal(0),
        createdById: context.actor!.id,
      },
    });
    const totalAmount = await writeItems(tx, created.id, body.items);
    return tx.purchaseOrder.update({
      where: { id: created.id },
      data: { totalAmount },
    });
  });

  audit({
    action: AUDIT.PURCHASE_ORDER_CREATED,
    entityType: 'PurchaseOrder',
    entityId: order.id,
    afterState: { orderNumber: order.orderNumber, status: order.status },
    context,
  });
  return order;
}

export async function updatePurchaseOrder(
  id: string,
  body: {
    orderDate?: string;
    expectedDelivery?: string | null;
    notes?: string | null;
    items?: PurchaseOrderItemInput[];
  },
  context: Context,
) {
  const existing = await ensureOrder(id);
  if (existing.status !== PurchaseOrderStatus.DRAFT) {
    throw new ApiError(409, 'INVALID_PURCHASE_ORDER_STATUS', 'Only draft purchase orders can be edited');
  }
  if (body.items) {
    await validateItems(body.items);
  }

  const order = await prisma.$transaction(async (tx) => {
    let totalAmount = existing.totalAmount;
    if (body.items) {
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      totalAmount = await writeItems(tx, id, body.items);
    }
    return tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(body.orderDate !== undefined ? { orderDate: new Date(body.orderDate) } : {}),
        ...(body.expectedDelivery !== undefined ? { expectedDelivery: body.expectedDelivery ? new Date(body.expectedDelivery) : null } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        totalAmount,
      },
    });
  });

  audit({
    action: AUDIT.PURCHASE_ORDER_UPDATED,
    entityType: 'PurchaseOrder',
    entityId: id,
    beforeState: { status: existing.status, totalAmount: Number(existing.totalAmount) },
    afterState: { status: order.status, totalAmount: Number(order.totalAmount) },
    context,
  });
  return order;
}

export async function submitPurchaseOrder(id: string, context: Context) {
  const existing = await ensureOrder(id);
  if (existing.status !== PurchaseOrderStatus.DRAFT) {
    throw new ApiError(409, 'INVALID_PURCHASE_ORDER_STATUS', 'Only draft purchase orders can be submitted');
  }
  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: PurchaseOrderStatus.PENDING },
  });
  audit({
    action: AUDIT.PURCHASE_ORDER_SUBMITTED,
    entityType: 'PurchaseOrder',
    entityId: id,
    beforeState: { status: existing.status },
    afterState: { status: order.status },
    context,
  });
  return order;
}

export async function cancelPurchaseOrder(id: string, context: Context) {
  const existing = await ensureOrder(id);
  if (
    existing.status !== PurchaseOrderStatus.DRAFT &&
    existing.status !== PurchaseOrderStatus.PENDING
  ) {
    throw new ApiError(
      409,
      'INVALID_PURCHASE_ORDER_STATUS',
      'Only draft or pending purchase orders can be cancelled',
    );
  }
  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: PurchaseOrderStatus.CANCELLED },
  });
  audit({
    action: AUDIT.PURCHASE_ORDER_CANCELLED,
    entityType: 'PurchaseOrder',
    entityId: id,
    beforeState: { status: existing.status },
    afterState: { status: order.status },
    context,
  });
  return order;
}

export const ORDERABLE_PO_STATUSES = ORDERABLE_STATUSES;