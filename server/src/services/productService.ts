import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { ApiError } from '../middleware/error.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../utils/audit.js';
import { orderBy, paginate, type PaginationResult } from '../utils/pagination.js';
import { AUDIT } from '../constants/auditActions.js';
import { InventoryTransactionType } from '@prisma/client';
import { increaseStockTx } from './inventoryService.js';

export type Status = 'ACTIVE' | 'INACTIVE';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  status: Status;
  categoryId: string | null;
  brandId: string | null;
  costPrice: Prisma.Decimal;
  retailPrice: Prisma.Decimal;
  wholesalePrice: Prisma.Decimal;
  category: { id: string; name: string; slug: string; status: string } | null;
  brand: { id: string; name: string; status: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  minimumStock: number;
  reorderLevel: number;
}

const listInclude = {
  category: { select: { id: true, name: true, slug: true, status: true } },
  brand: { select: { id: true, name: true, status: true } },
} satisfies Prisma.ProductInclude;

const detailInclude = {
  category: { select: { id: true, name: true, slug: true, status: true } },
  brand: { select: { id: true, name: true, status: true } },
} satisfies Prisma.ProductInclude;

function toListItem(product: Prisma.ProductGetPayload<{ include: typeof listInclude }>): ProductListItem {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    status: product.status,
    categoryId: product.categoryId,
    brandId: product.brandId,
    costPrice: product.costPrice,
    retailPrice: product.retailPrice,
    wholesalePrice: product.wholesalePrice,
    category: product.category,
    brand: product.brand,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function toDetail(product: Prisma.ProductGetPayload<{ include: typeof detailInclude }>): ProductDetail {
  return {
    ...toListItem(product),
    description: product.description,
    minimumStock: product.minimumStock,
    reorderLevel: product.reorderLevel,
  };
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

async function resolveCategory(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw ApiError.badRequest('Category does not exist');
}

async function resolveBrand(brandId: string | null | undefined): Promise<void> {
  if (!brandId) return;
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) throw ApiError.badRequest('Brand does not exist');
}

async function assertSkuAvailable(sku: string, excludeProductId?: string): Promise<void> {
  const existing = await prisma.product.findUnique({ where: { sku } });
  if (existing && existing.id !== excludeProductId) {
    throw new ApiError(409, 'DUPLICATE_SKU', `SKU "${sku}" is already in use`);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const SORT_FIELDS: Record<string, string> = {
  name: 'name',
  sku: 'sku',
  costPrice: 'costPrice',
  retailPrice: 'retailPrice',
  wholesalePrice: 'wholesalePrice',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

export async function listProducts(query: {
  q?: string;
  categoryId?: string;
  brandId?: string;
  status?: Status;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): Promise<PaginationResult<ProductListItem>> {
  const and: Prisma.ProductWhereInput[] = [];

  if (query.status) and.push({ status: query.status });
  if (query.categoryId) and.push({ categoryId: query.categoryId });
  if (query.brandId) and.push({ brandId: query.brandId });

  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { sku: { contains: query.q, mode: 'insensitive' } },
        { brand: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
        { category: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
      ],
    });
  }

  const where: Prisma.ProductWhereInput = and.length > 0 ? { AND: and } : {};

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, totalItems] = await Promise.all([
    prisma.product.findMany({
      where,
      include: listInclude,
      orderBy: orderBy(query.sortBy ?? 'name', query.sortOrder ?? 'asc', SORT_FIELDS),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return paginate(rows.map(toListItem), page, pageSize, totalItems);
}

export async function getProduct(id: string): Promise<ProductDetail> {
  const product = await prisma.product.findUnique({ where: { id }, include: detailInclude });
  if (!product) throw ApiError.notFound('Product not found');
  return toDetail(product);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createProduct(
  input: {
    sku: string;
    name: string;
    description?: string | null;
    categoryId: string;
    brandId?: string | null;
    costPrice: number;
    retailPrice: number;
    wholesalePrice: number;
    minimumStock: number;
    reorderLevel: number;
    status?: Status;
    quantityOnHand?: number;
  },
  ctx: { request: Request; actor: { id: string } },
): Promise<ProductDetail> {
  await resolveCategory(input.categoryId);
  await resolveBrand(input.brandId);
  await assertSkuAvailable(input.sku);

  const quantityOnHand = input.quantityOnHand ?? 0;

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        sku: input.sku.trim(),
        name: input.name.trim(),
        description: input.description ?? null,
        categoryId: input.categoryId,
        brandId: input.brandId ?? null,
        costPrice: input.costPrice,
        retailPrice: input.retailPrice,
        wholesalePrice: input.wholesalePrice,
        minimumStock: input.minimumStock,
        reorderLevel: input.reorderLevel,
        status: input.status ?? 'ACTIVE',
      },
    });

    if (quantityOnHand > 0) {
      await increaseStockTx(tx, {
        productId: created.id,
        quantity: quantityOnHand,
        unitCost: input.costPrice,
        type: InventoryTransactionType.INITIAL,
        note: 'Initial stock on hand',
        createdById: ctx.actor.id,
      });
    }

    return created;
  });

  const detail = await prisma.product.findUnique({
    where: { id: product.id },
    include: detailInclude,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.PRODUCT_CREATED,
    entityType: 'product',
    entityId: product.id,
    afterState: {
      sku: product.sku,
      name: product.name,
      categoryId: product.categoryId,
      brandId: product.brandId,
      costPrice: product.costPrice,
      quantityOnHand,
    },
  });

  return toDetail(detail!);
}

export async function updateProduct(
  id: string,
  input: {
    sku?: string;
    name?: string;
    description?: string | null;
    categoryId?: string;
    brandId?: string | null;
    costPrice?: number;
    retailPrice?: number;
    wholesalePrice?: number;
    minimumStock?: number;
    reorderLevel?: number;
    status?: Status;
  },
  ctx: { request: Request; actor: { id: string } },
): Promise<ProductDetail> {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Product not found');

  if (input.categoryId !== undefined) await resolveCategory(input.categoryId);
  if (input.brandId !== undefined) await resolveBrand(input.brandId);
  if (input.sku !== undefined) await assertSkuAvailable(input.sku, id);

  const data: Prisma.ProductUncheckedUpdateInput = {};
  if (input.sku !== undefined) data.sku = input.sku.trim();
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.categoryId !== undefined) data.categoryId = input.categoryId;
  if (input.brandId !== undefined) data.brandId = input.brandId ?? null;
  if (input.costPrice !== undefined) data.costPrice = input.costPrice;
  if (input.retailPrice !== undefined) data.retailPrice = input.retailPrice;
  if (input.wholesalePrice !== undefined) data.wholesalePrice = input.wholesalePrice;
  if (input.minimumStock !== undefined) data.minimumStock = input.minimumStock;
  if (input.reorderLevel !== undefined) data.reorderLevel = input.reorderLevel;
  if (input.status !== undefined) data.status = input.status;

  const product = await prisma.product.update({ where: { id }, data, include: detailInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.PRODUCT_UPDATED,
    entityType: 'product',
    entityId: id,
    beforeState: {
      sku: existing.sku,
      name: existing.name,
      categoryId: existing.categoryId,
      brandId: existing.brandId,
      costPrice: existing.costPrice,
      retailPrice: existing.retailPrice,
      wholesalePrice: existing.wholesalePrice,
    },
    afterState: {
      sku: product.sku,
      name: product.name,
      categoryId: product.categoryId,
      brandId: product.brandId,
      costPrice: product.costPrice,
      retailPrice: product.retailPrice,
      wholesalePrice: product.wholesalePrice,
    },
  });

  return toDetail(product);
}

export async function setProductStatus(
  id: string,
  status: Status,
  ctx: { request: Request; actor: { id: string } },
): Promise<ProductDetail> {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Product not found');

  const product = await prisma.product.update({
    where: { id },
    data: { status },
    include: detailInclude,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: status === 'ACTIVE' ? AUDIT.PRODUCT_ACTIVATED : AUDIT.PRODUCT_DEACTIVATED,
    entityType: 'product',
    entityId: id,
    afterState: { status },
  });

  return toDetail(product);
}

export async function deleteProduct(
  id: string,
  ctx: { request: Request; actor: { id: string } },
): Promise<void> {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Product not found');

  const [saleItems, saleReturnItems, inventoryTransactions, reservations, supplierProducts, purchaseRefs] =
    await Promise.all([
      prisma.saleItem.count({ where: { productId: id } }),
      prisma.saleReturnItem.count({ where: { productId: id } }),
      prisma.inventoryTransaction.count({ where: { productId: id } }),
      prisma.stockReservation.count({ where: { productId: id } }),
      prisma.supplierProduct.count({ where: { productId: id } }),
      Promise.all([
        prisma.purchaseOrderItem.count({ where: { productId: id } }),
        prisma.purchaseItem.count({ where: { productId: id } }),
        prisma.purchaseReturnItem.count({ where: { productId: id } }),
      ]).then((sums) => sums.reduce((a, b) => a + b, 0)),
    ]);

  if (saleItems + saleReturnItems + inventoryTransactions + reservations + supplierProducts + purchaseRefs > 0) {
    throw new ApiError(
      409,
      'PRODUCT_IN_USE',
      'This product has sales or inventory history and cannot be deleted. Deactivate it instead.',
    );
  }

  await prisma.$transaction([
    prisma.productIdentifier.deleteMany({ where: { productId: id } }),
    prisma.productCompatibility.deleteMany({ where: { productId: id } }),
    prisma.inventory.deleteMany({ where: { productId: id } }),
    prisma.product.delete({ where: { id } }),
  ]);

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.PRODUCT_DELETED,
    entityType: 'product',
    entityId: id,
    beforeState: {
      sku: existing.sku,
      name: existing.name,
      categoryId: existing.categoryId,
      brandId: existing.brandId,
    },
  });
}