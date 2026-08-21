import { randomUUID } from 'node:crypto';
import {
  InventoryTransactionType,
  NotificationType,
  Prisma,
  ReservationStatus,
  UserStatus,
} from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

export type StockStatus = 'HEALTHY' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface InventorySnapshot {
  productId: string;
  sku: string;
  name: string;
  quantityOnHand: number;
  quantityReserved: number;
  available: number;
  weightedAverageCost: string;
  inventoryValue: string;
  status: StockStatus;
}

interface ProductRef {
  id: string;
  sku: string;
  name: string;
  minimumStock: number;
  reorderLevel: number;
}

interface LockedInventory {
  id: string;
  productId: string;
  quantityOnHand: number;
  quantityReserved: number;
  weightedAverageCost: Prisma.Decimal;
}

interface MovementInput {
  productId: string;
  quantity: number;
  referenceId?: string | null;
  note?: string | null;
  type?: InventoryTransactionType;
  createdById?: string | null;
  request?: Request;
}

interface StockSnapshotInput {
  quantityOnHand: number;
  quantityReserved: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(String(value));
}

/** reorderLevel is the primary replenishment threshold; minimumStock is the fallback. */
function lowStockThreshold(product: ProductRef): number {
  return product.reorderLevel > 0 ? product.reorderLevel : product.minimumStock;
}

function stockStatusOf(available: number, threshold: number): StockStatus {
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= threshold) return 'LOW_STOCK';
  return 'HEALTHY';
}

function availableOf(snapshot: StockSnapshotInput): number {
  return snapshot.quantityOnHand - snapshot.quantityReserved;
}

function snapshotFrom(product: ProductRef, inv: { quantityOnHand: number; quantityReserved: number; weightedAverageCost: Prisma.Decimal }): InventorySnapshot {
  const available = availableOf(inv);
  const value = inv.weightedAverageCost.mul(inv.quantityOnHand);
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    quantityOnHand: inv.quantityOnHand,
    quantityReserved: inv.quantityReserved,
    available,
    weightedAverageCost: inv.weightedAverageCost.toFixed(2),
    inventoryValue: value.toFixed(2),
    status: stockStatusOf(available, lowStockThreshold(product)),
  };
}

/**
 * Serializes concurrent mutations against a single product row. Atomically
 * ensures the inventory row exists, then locks it, so only one transaction
 * owns the row at a time and later mutations in this transaction see a stable
 * snapshot. Two steps, both race-safe:
 *
 *   1. `INSERT ... ON CONFLICT DO NOTHING RETURNING`: if a concurrent
 *      transaction won the race the insert no-ops (waiting on the unique
 *      index until the winner commits), so no unique-violation abort (25P02)
 *      can happen; a returned row is the freshly created one (ours alone).
 *   2. Otherwise `SELECT ... FOR UPDATE`: locks and reads the existing row.
 */
async function lockInventory(tx: Tx, productId: string): Promise<LockedInventory> {
  const insertSql = Prisma.sql`
    INSERT INTO "inventories" ("productId", "id", "quantityOnHand", "quantityReserved", "weightedAverageCost", "updatedAt")
    VALUES (${productId}, ${randomUUID()}, 0, 0, 0, NOW())
    ON CONFLICT ("productId") DO NOTHING
    RETURNING "id", "quantityOnHand", "quantityReserved", "weightedAverageCost"
  `;
  const inserted = await tx.$queryRaw<
    Array<{
      id: string;
      quantityOnHand: number;
      quantityReserved: number;
      weightedAverageCost: Prisma.Decimal | string;
    }>
  >(insertSql);
  if (inserted[0]) {
    return {
      id: inserted[0].id,
      productId,
      quantityOnHand: Number(inserted[0].quantityOnHand),
      quantityReserved: Number(inserted[0].quantityReserved),
      weightedAverageCost: decimal(inserted[0].weightedAverageCost),
    };
  }

  const lockSql = Prisma.sql`
    SELECT "id", "quantityOnHand", "quantityReserved", "weightedAverageCost"
    FROM "inventories"
    WHERE "productId" = ${productId}
    FOR UPDATE
  `;
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      quantityOnHand: number;
      quantityReserved: number;
      weightedAverageCost: Prisma.Decimal | string;
    }>
  >(lockSql);
  if (!rows[0]) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Failed to lock inventory row');
  }
  return {
    id: rows[0].id,
    productId,
    quantityOnHand: Number(rows[0].quantityOnHand),
    quantityReserved: Number(rows[0].quantityReserved),
    weightedAverageCost: decimal(rows[0].weightedAverageCost),
  };
}

async function ensureProduct(tx: Tx, productId: string): Promise<ProductRef> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, minimumStock: true, reorderLevel: true },
  });
  if (!product) {
    throw ApiError.notFound('Product not found');
  }
  return product;
}

/**
 * Idempotent low-stock notifications. Called only after a mutation that may
 * have changed availability. One unread notification per (type, productId) per
 * ACTIVE user; never created on reads. Notifications are informational and
 * best-effort; a notification failure must not fail the mutation.
 */
async function notifyLowStock(
  tx: Tx,
  product: ProductRef,
  snapshot: StockSnapshotInput,
): Promise<number> {
  const available = availableOf(snapshot);
  const status = stockStatusOf(available, lowStockThreshold(product));
  if (status === 'HEALTHY') return 0;

  const type = status === 'OUT_OF_STOCK' ? NotificationType.OUT_OF_STOCK : NotificationType.LOW_STOCK;
  const title = type === NotificationType.OUT_OF_STOCK ? 'Out of stock' : 'Low stock alert';
  const message =
    type === NotificationType.OUT_OF_STOCK
      ? `${product.name} (${product.sku}) is out of stock.`
      : `${product.name} (${product.sku}) has fallen below its reorder level (threshold ${lowStockThreshold(product)}).`;

  const users = await tx.user.findMany({
    where: { status: UserStatus.ACTIVE },
    select: { id: true },
  });

  let created = 0;
  for (const user of users) {
    const existing = await tx.notification.findFirst({
      where: {
        userId: user.id,
        type,
        readAt: null,
        data: { path: ['productId'], equals: product.id },
      },
    });
    if (existing) continue;
    await tx.notification.create({
      data: {
        userId: user.id,
        type,
        title,
        message,
        data: {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantityOnHand: snapshot.quantityOnHand,
          available,
          reorderLevel: lowStockThreshold(product),
        },
      },
    });
    created += 1;
  }
  return created;
}

function assertPositiveQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ApiError(400, 'INVALID_QUANTITY', 'Quantity must be a positive integer');
  }
}

function assertNonNegativeCost(cost: number): void {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    throw new ApiError(400, 'INVALID_COST', 'Unit cost cannot be negative');
  }
}

function auditRecord(input: { action: string; entityType: string; entityId: string; beforeState?: Prisma.InputJsonValue; afterState?: Prisma.InputJsonValue; request?: Request; userId?: string | null }): void {
  void recordAudit({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    beforeState: input.beforeState,
    afterState: input.afterState,
    request: input.request,
    userId: input.userId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Records stock coming in (purchase receipt, return, initial stock). */
export async function increaseStock(
  input: MovementInput & { unitCost: number },
): Promise<{ inventory: InventorySnapshot; transactionId: string; notificationsCreated: number }> {
  assertPositiveQuantity(input.quantity);
  assertNonNegativeCost(input.unitCost);

  const result = await prisma.$transaction((tx) => increaseStockTx(tx, input));

  auditRecord({
    action: AUDIT.INVENTORY_STOCK_IN,
    entityType: 'Product',
    entityId: input.productId,
    afterState: { quantityOnHand: result.inventory.quantityOnHand, weightedAverageCost: result.inventory.weightedAverageCost },
    request: input.request,
    userId: input.createdById,
  });
  return result;
}

/**
 * Transaction-aware stock-in. Used both by increaseStock and by outer
 * transactions (e.g. PO receiving) that must mutate inventory atomically with
 * their own records. Never call outside a transaction.
 */
export async function increaseStockTx(
  tx: Tx,
  input: MovementInput & { unitCost: number },
): Promise<{ inventory: InventorySnapshot; transactionId: string; notificationsCreated: number }> {
  assertPositiveQuantity(input.quantity);
  assertNonNegativeCost(input.unitCost);
  const type = input.type ?? InventoryTransactionType.PURCHASE;

  const product = await ensureProduct(tx, input.productId);
  const inv = await lockInventory(tx, input.productId);

  const incoming = decimal(input.unitCost);
  const newOnHand = inv.quantityOnHand + input.quantity;
  let newAverage: Prisma.Decimal;
  if (inv.quantityOnHand <= 0) {
    newAverage = incoming;
  } else {
    const totalValue = inv.weightedAverageCost
      .mul(inv.quantityOnHand)
      .add(incoming.mul(input.quantity));
    newAverage = totalValue.div(newOnHand).toDecimalPlaces(2);
  }

  await tx.inventory.update({
    where: { id: inv.id },
    data: { quantityOnHand: newOnHand, weightedAverageCost: newAverage },
  });
  const transaction = await tx.inventoryTransaction.create({
    data: {
      productId: input.productId,
      inventoryId: inv.id,
      type,
      quantity: input.quantity,
      unitCost: incoming,
      balanceAfter: newOnHand,
      referenceId: input.referenceId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
  const notificationsCreated = await notifyLowStock(tx, product, {
    quantityOnHand: newOnHand,
    quantityReserved: inv.quantityReserved,
  });

  return {
    inventory: snapshotFrom(product, {
      quantityOnHand: newOnHand,
      quantityReserved: inv.quantityReserved,
      weightedAverageCost: newAverage,
    }),
    transactionId: transaction.id,
    notificationsCreated,
  };
}

/** Records stock going out (sale, return to supplier, usage). */
export async function decreaseStock(
  input: MovementInput,
): Promise<{ inventory: InventorySnapshot; transactionId: string; notificationsCreated: number }> {
  assertPositiveQuantity(input.quantity);
  const type = input.type ?? InventoryTransactionType.SALE;

  const result = await prisma.$transaction((tx) => decreaseStockTx(tx, { ...input, type }));

  auditRecord({
    action: AUDIT.INVENTORY_STOCK_OUT,
    entityType: 'Product',
    entityId: input.productId,
    afterState: { quantityOnHand: result.inventory.quantityOnHand },
    request: input.request,
    userId: input.createdById,
  });
  return result;
}

/**
 * Transaction-aware stock-out. Used both by decreaseStock and by outer
 * transactions (e.g. sale creation) that must deduct inventory atomically
 * with their own records. Never call outside a transaction.
 *
 * Returns the frozen unit cost (the weighted-average cost that applied to
 * this movement) so the caller can record historical COGS on the business
 * record (e.g. SaleItem.unitCost).
 */
export async function decreaseStockTx(
  tx: Tx,
  input: MovementInput & { type?: InventoryTransactionType },
): Promise<{ inventory: InventorySnapshot; transactionId: string; unitCost: Prisma.Decimal; notificationsCreated: number }> {
  assertPositiveQuantity(input.quantity);
  const type = input.type ?? InventoryTransactionType.SALE;

  const product = await ensureProduct(tx, input.productId);
  const inv = await lockInventory(tx, input.productId);

  const available = availableOf(inv);
  if (input.quantity > available) {
    throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Insufficient stock for this movement');
  }

  const newOnHand = inv.quantityOnHand - input.quantity;
  const unitCost = inv.weightedAverageCost;

  await tx.inventory.update({
    where: { id: inv.id },
    data: { quantityOnHand: newOnHand },
  });
  const transaction = await tx.inventoryTransaction.create({
    data: {
      productId: input.productId,
      inventoryId: inv.id,
      type,
      quantity: -input.quantity,
      unitCost,
      balanceAfter: newOnHand,
      referenceId: input.referenceId ?? null,
      note: input.note ?? null,
      createdById: input.createdById ?? null,
    },
  });
  const notificationsCreated = await notifyLowStock(tx, product, {
    quantityOnHand: newOnHand,
    quantityReserved: inv.quantityReserved,
  });

  return {
    inventory: snapshotFrom(product, {
      quantityOnHand: newOnHand,
      quantityReserved: inv.quantityReserved,
      weightedAverageCost: inv.weightedAverageCost,
    }),
    transactionId: transaction.id,
    unitCost,
    notificationsCreated,
  };
}

/** Stocktake adjustment for shrinkage, damage, breakage or corrections. */
export async function adjust(input: {
  productId: string;
  quantity: number;
  reason: string;
  type?: 'ADJUSTMENT' | 'DAMAGE' | 'LOSS';
  createdById?: string | null;
  request?: Request;
}): Promise<{ inventory: InventorySnapshot; transactionId: string; notificationsCreated: number }> {
  const quantity = input.quantity;
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new ApiError(400, 'INVALID_QUANTITY', 'Adjustment quantity must be a non-zero integer');
  }
  if (!input.reason || input.reason.trim().length === 0) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required for stock adjustments');
  }
  const type = input.type ?? 'ADJUSTMENT';
  if (quantity > 0 && type !== 'ADJUSTMENT') {
    throw new ApiError(400, 'INVALID_ADJUSTMENT_TYPE', 'Positive adjustments must use type ADJUSTMENT');
  }

  const result = await prisma.$transaction(async (tx) => {
    const product = await ensureProduct(tx, input.productId);
    const inv = await lockInventory(tx, input.productId);

    const newOnHand = inv.quantityOnHand + quantity;
    if (newOnHand < 0) {
      throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Adjustment would drive stock below zero');
    }

    // Positive adjustments add stock at the current weighted average cost;
    // negative adjustments consume stock at the current average cost. The
    // average itself is unchanged.
    const unitCost = inv.weightedAverageCost;

    await tx.inventory.update({
      where: { id: inv.id },
      data: { quantityOnHand: newOnHand },
    });
    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId: input.productId,
        inventoryId: inv.id,
        type,
        quantity,
        unitCost,
        balanceAfter: newOnHand,
        referenceId: null,
        note: input.reason,
        createdById: input.createdById ?? null,
      },
    });
    const notificationsCreated = await notifyLowStock(tx, product, {
      quantityOnHand: newOnHand,
      quantityReserved: inv.quantityReserved,
    });

    return {
      inventory: snapshotFrom(product, {
        quantityOnHand: newOnHand,
        quantityReserved: inv.quantityReserved,
        weightedAverageCost: inv.weightedAverageCost,
      }),
      transactionId: transaction.id,
      notificationsCreated,
    };
  });

  auditRecord({
    action: AUDIT.INVENTORY_STOCK_ADJUSTED,
    entityType: 'Product',
    entityId: input.productId,
    afterState: { quantityOnHand: result.inventory.quantityOnHand, note: input.reason },
    request: input.request,
    userId: input.createdById,
  });
  return result;
}

/** Reserves available stock for a customer order. Never touches quantityOnHand. */
export async function reserve(input: {
  productId: string;
  quantity: number;
  reservedUntil?: string | Date | null;
  note?: string | null;
  createdById: string;
  request?: Request;
}): Promise<{
  reservation: { id: string; productId: string; quantity: number; status: ReservationStatus; reservedUntil: Date | null; note: string | null };
  inventory: InventorySnapshot;
  transactionId: string;
  notificationsCreated: number;
}> {
  assertPositiveQuantity(input.quantity);

  const result = await prisma.$transaction(async (tx) => {
    const product = await ensureProduct(tx, input.productId);
    const inv = await lockInventory(tx, input.productId);

    const available = availableOf(inv);
    if (input.quantity > available) {
      throw new ApiError(409, 'INSUFFICIENT_AVAILABLE_STOCK', 'Insufficient available stock for reservation');
    }

    const reservation = await tx.stockReservation.create({
      data: {
        productId: input.productId,
        quantity: input.quantity,
        status: ReservationStatus.ACTIVE,
        reservedUntil: input.reservedUntil ? new Date(input.reservedUntil) : null,
        note: input.note ?? null,
        createdById: input.createdById,
      },
    });

    const newReserved = inv.quantityReserved + input.quantity;
    await tx.inventory.update({
      where: { id: inv.id },
      data: { quantityReserved: newReserved },
    });
    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId: input.productId,
        inventoryId: inv.id,
        type: InventoryTransactionType.RESERVATION,
        quantity: 0,
        unitCost: null,
        balanceAfter: inv.quantityOnHand,
        referenceId: reservation.id,
        note: `Reserved ${input.quantity} units`,
        createdById: input.createdById,
      },
    });
    const notificationsCreated = await notifyLowStock(tx, product, {
      quantityOnHand: inv.quantityOnHand,
      quantityReserved: newReserved,
    });

    return {
      reservation: {
        id: reservation.id,
        productId: reservation.productId,
        quantity: reservation.quantity,
        status: reservation.status,
        reservedUntil: reservation.reservedUntil,
        note: reservation.note,
      },
      inventory: snapshotFrom(product, {
        quantityOnHand: inv.quantityOnHand,
        quantityReserved: newReserved,
        weightedAverageCost: inv.weightedAverageCost,
      }),
      transactionId: transaction.id,
      notificationsCreated,
    };
  });

  auditRecord({
    action: AUDIT.INVENTORY_RESERVATION_CREATED,
    entityType: 'StockReservation',
    entityId: result.reservation.id,
    afterState: { productId: result.reservation.productId, quantity: result.reservation.quantity },
    request: input.request,
    userId: input.createdById,
  });
  return result;
}

/** Releases a reservation, returning the quantity to available stock. */
export async function releaseReservation(input: {
  reservationId: string;
  createdById: string;
  request?: Request;
}): Promise<{
  reservation: { id: string; productId: string; quantity: number; status: ReservationStatus; reservedUntil: Date | null; note: string | null };
  inventory: InventorySnapshot;
  transactionId: string;
  notificationsCreated: number;
}> {
  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.stockReservation.findUnique({
      where: { id: input.reservationId },
    });
    if (!reservation) {
      throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }
    if (reservation.status !== ReservationStatus.ACTIVE) {
      throw new ApiError(409, 'RESERVATION_ALREADY_RELEASED', 'Reservation has already been released');
    }

    const product = await ensureProduct(tx, reservation.productId);
    const inv = await lockInventory(tx, reservation.productId);

    const newReserved = Math.max(0, inv.quantityReserved - reservation.quantity);
    await tx.inventory.update({
      where: { id: inv.id },
      data: { quantityReserved: newReserved },
    });
    const updated = await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: ReservationStatus.CANCELLED },
    });
    const transaction = await tx.inventoryTransaction.create({
      data: {
        productId: reservation.productId,
        inventoryId: inv.id,
        type: InventoryTransactionType.RESERVATION_RELEASE,
        quantity: 0,
        unitCost: null,
        balanceAfter: inv.quantityOnHand,
        referenceId: reservation.id,
        note: `Released ${reservation.quantity} units`,
        createdById: input.createdById,
      },
    });
    const notificationsCreated = await notifyLowStock(tx, product, {
      quantityOnHand: inv.quantityOnHand,
      quantityReserved: newReserved,
    });

    return {
      reservation: {
        id: updated.id,
        productId: updated.productId,
        quantity: updated.quantity,
        status: updated.status,
        reservedUntil: updated.reservedUntil,
        note: updated.note,
      },
      inventory: snapshotFrom(product, {
        quantityOnHand: inv.quantityOnHand,
        quantityReserved: newReserved,
        weightedAverageCost: inv.weightedAverageCost,
      }),
      transactionId: transaction.id,
      notificationsCreated,
    };
  });

  auditRecord({
    action: AUDIT.INVENTORY_RESERVATION_RELEASED,
    entityType: 'StockReservation',
    entityId: result.reservation.id,
    afterState: { status: result.reservation.status },
    request: input.request,
    userId: input.createdById,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface ProductLike {
  id: string;
  sku: string;
  name: string;
  minimumStock: number;
  reorderLevel: number;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  updatedAt: Date;
  inventory: { quantityOnHand: number; quantityReserved: number; weightedAverageCost: Prisma.Decimal; updatedAt: Date } | null;
}

function productSearchWhere(query: {
  q?: string;
  categoryId?: string;
  brandId?: string;
  status?: string;
  makeId?: string;
  modelId?: string;
  variantId?: string;
}): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];
  if (query.status) and.push({ status: query.status as 'ACTIVE' | 'INACTIVE' });
  if (query.categoryId) and.push({ categoryId: query.categoryId });
  if (query.brandId) and.push({ brandId: query.brandId });
  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { sku: { contains: query.q, mode: 'insensitive' } },
        { identifiers: { some: { value: { contains: query.q, mode: 'insensitive' } } } },
        { brand: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
        { category: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
      ],
    });
  }
  if (query.variantId) and.push({ compatibilities: { some: { variantId: query.variantId } } });
  if (query.modelId) and.push({ compatibilities: { some: { variant: { modelId: query.modelId } } } });
  if (query.makeId) and.push({ compatibilities: { some: { variant: { model: { makeId: query.makeId } } } } });
  return and.length > 0 ? { AND: and } : {};
}

const INVENTORY_LIST_LIMIT = 10_000;

function toListRow(product: ProductLike) {
  const inv = product.inventory;
  const onHand = inv?.quantityOnHand ?? 0;
  const reserved = inv?.quantityReserved ?? 0;
  const available = onHand - reserved;
  const avgCost = inv ? inv.weightedAverageCost : decimal(0);
  const threshold = product.reorderLevel > 0 ? product.reorderLevel : product.minimumStock;
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    categoryName: product.categoryName,
    brandId: product.brandId,
    brandName: product.brandName,
    quantityOnHand: onHand,
    quantityReserved: reserved,
    available,
    weightedAverageCost: avgCost.toFixed(2),
    inventoryValue: avgCost.mul(onHand).toFixed(2),
    status: stockStatusOf(available, threshold),
    updatedAt: inv?.updatedAt ?? product.updatedAt,
  };
}

export async function listInventory(query: {
  q?: string;
  categoryId?: string;
  brandId?: string;
  status?: string;
  makeId?: string;
  modelId?: string;
  variantId?: string;
  stockStatus?: StockStatus;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const sortOrder = query.sortOrder ?? 'asc';

  const rows = await prisma.product.findMany({
    where: productSearchWhere(query),
    include: {
      inventory: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
    take: INVENTORY_LIST_LIMIT,
    orderBy: { name: 'asc' },
  });

  let items = rows.map((p) =>
    toListRow({
      id: p.id,
      sku: p.sku,
      name: p.name,
      minimumStock: p.minimumStock,
      reorderLevel: p.reorderLevel,
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      brandId: p.brandId,
      brandName: p.brand?.name ?? null,
      updatedAt: p.updatedAt,
      inventory: p.inventory,
    }),
  );

  if (query.stockStatus) {
    items = items.filter((i) => i.status === query.stockStatus);
  }

  const numericFields = ['quantityOnHand', 'quantityReserved', 'available', 'weightedAverageCost', 'inventoryValue'];
  if (query.sortBy && (numericFields.includes(query.sortBy) || ['name', 'sku', 'updatedAt'].includes(query.sortBy))) {
    items.sort((a, b) => {
      const av = a[query.sortBy as keyof typeof a];
      const bv = b[query.sortBy as keyof typeof a];
      const cmp = Number(av) > Number(bv) ? 1 : Number(av) < Number(bv) ? -1 : 0;
      return sortOrder === 'desc' ? -cmp : cmp;
    });
  }

  const totalItems = items.length;
  const totalPages = Math.max(0, Math.ceil(totalItems / pageSize));
  const paginated = items.slice((page - 1) * pageSize, page * pageSize);
  return { items: paginated, pagination: { page, pageSize, totalItems, totalPages } };
}

export async function getInventory(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      inventory: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      identifiers: true,
    },
  });
  if (!product) throw ApiError.notFound('Product not found');

  const onHand = product.inventory?.quantityOnHand ?? 0;
  const reserved = product.inventory?.quantityReserved ?? 0;
  const avgCost = product.inventory?.weightedAverageCost ?? decimal(0);
  const available = onHand - reserved;
  const threshold = product.reorderLevel > 0 ? product.reorderLevel : product.minimumStock;

  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? null,
    brandId: product.brandId,
    brandName: product.brand?.name ?? null,
    identifiers: product.identifiers,
    quantityOnHand: onHand,
    quantityReserved: reserved,
    available,
    weightedAverageCost: avgCost.toFixed(2),
    inventoryValue: avgCost.mul(onHand).toFixed(2),
    status: stockStatusOf(available, threshold),
    updatedAt: product.inventory?.updatedAt ?? product.updatedAt,
  };
}

export async function listTransactions(productId: string, query: {
  type?: InventoryTransactionType;
  movement?: 'in' | 'out' | 'reservation';
  userId?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}) {
  const where: Prisma.InventoryTransactionWhereInput = { productId };
  if (query.type) where.type = query.type;
  if (query.userId) where.createdById = query.userId;
  if (query.from || query.to) {
    where.createdAt = {
      gte: query.from ? new Date(query.from) : undefined,
      lte: query.to ? new Date(query.to) : undefined,
    };
  }

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const sortOrder = query.sortOrder ?? 'desc';

  const rows = await prisma.inventoryTransaction.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: sortOrder },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const totalItems = await prisma.inventoryTransaction.count({ where });

  let items = rows.map((t) => ({
    id: t.id,
    productId: t.productId,
    type: t.type,
    quantity: t.quantity,
    unitCost: t.unitCost?.toFixed(2) ?? null,
    balanceAfter: t.balanceAfter,
    referenceId: t.referenceId,
    note: t.note,
    createdAt: t.createdAt,
    product: t.product,
    createdBy: t.createdBy,
  }));

  if (query.movement) {
    const keep = (q: number, type: string) =>
      query.movement === 'in'
        ? q > 0
        : query.movement === 'out'
          ? q < 0
          : ['RESERVATION', 'RESERVATION_RELEASE'].includes(type);
    items = items.filter((i) => keep(i.quantity, i.type));
  }

  return {
    items,
    pagination: { page, pageSize, totalItems, totalPages: Math.max(0, Math.ceil(totalItems / pageSize)) },
  };
}

export async function listReservations(query: {
  status?: ReservationStatus;
  productId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}) {
  const where: Prisma.StockReservationWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.productId) where.productId = query.productId;

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const sortOrder = query.sortOrder ?? 'desc';

  const [rows, totalItems] = await Promise.all([
    prisma.stockReservation.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockReservation.count({ where }),
  ]);

  return {
    items: rows,
    pagination: { page, pageSize, totalItems, totalPages: Math.max(0, Math.ceil(totalItems / pageSize)) },
  };
}

export async function listLowStock(query: {
  q?: string;
  categoryId?: string;
  brandId?: string;
  stockStatus?: 'LOW_STOCK' | 'OUT_OF_STOCK';
  page?: number;
  pageSize?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const rows = await prisma.product.findMany({
    where: productSearchWhere(query),
    include: {
      inventory: true,
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
    take: INVENTORY_LIST_LIMIT,
    orderBy: { name: 'asc' },
  });

  let items = rows
    .map((p) =>
      toListRow({
        id: p.id,
        sku: p.sku,
        name: p.name,
        minimumStock: p.minimumStock,
        reorderLevel: p.reorderLevel,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
        brandId: p.brandId,
        brandName: p.brand?.name ?? null,
        updatedAt: p.updatedAt,
        inventory: p.inventory,
      }),
    )
    .filter((i) => i.status !== 'HEALTHY');

  if (query.stockStatus) {
    items = items.filter((i) => i.status === query.stockStatus);
  }

  items.sort((a, b) => a.available - b.available);

  const totalItems = items.length;
  const totalPages = Math.max(0, Math.ceil(totalItems / pageSize));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, totalItems, totalPages } };
}