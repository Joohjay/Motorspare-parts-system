import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { ApiError } from '../middleware/error.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../utils/audit.js';
import { orderBy, paginate, type PaginationResult } from '../utils/pagination.js';
import { AUDIT } from '../constants/auditActions.js';

export type Status = 'ACTIVE' | 'INACTIVE';
export type IdentifierTypeValue =
  | 'PART_NUMBER'
  | 'OEM_NUMBER'
  | 'ALTERNATIVE_NUMBER'
  | 'SUPPLIER_NUMBER'
  | 'OTHER';

export interface IdentifierInput {
  type: IdentifierTypeValue;
  value: string;
}

export interface CompatibilityInput {
  variantId: string;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  status: Status;
  categoryId: string;
  brandId: string | null;
  retailPrice: Prisma.Decimal;
  wholesalePrice: Prisma.Decimal;
  category: { id: string; name: string; slug: string; status: string } | null;
  brand: { id: string; name: string; status: string } | null;
  identifiers: { id: string; type: string; value: string }[];
  compatibilityCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  minimumStock: number;
  reorderLevel: number;
  compatibilities: {
    id: string;
    notes: string | null;
    variant: {
      id: string;
      name: string;
      yearFrom: number | null;
      yearTo: number | null;
      model: { id: string; name: string; make: { id: string; name: string } };
    };
  }[];
}

const listInclude = {
  category: { select: { id: true, name: true, slug: true, status: true } },
  brand: { select: { id: true, name: true, status: true } },
  identifiers: { select: { id: true, type: true, value: true } },
} satisfies Prisma.ProductInclude;

const detailInclude = {
  category: { select: { id: true, name: true, slug: true, status: true } },
  brand: { select: { id: true, name: true, status: true } },
  identifiers: { select: { id: true, type: true, value: true } },
  compatibilities: {
    include: {
      variant: {
        include: {
          model: {
            include: { make: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.ProductInclude;

function toListItem(
  product: Prisma.ProductGetPayload<{ include: typeof listInclude }> & {
    _count?: { compatibilities: number };
  },
): ProductListItem {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    status: product.status,
    categoryId: product.categoryId,
    brandId: product.brandId,
    retailPrice: product.retailPrice,
    wholesalePrice: product.wholesalePrice,
    category: product.category,
    brand: product.brand,
    identifiers: product.identifiers,
    compatibilityCount: product._count?.compatibilities ?? 0,
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
    compatibilities: product.compatibilities,
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

async function resolveVariants(entries: CompatibilityInput[]): Promise<void> {
  for (const entry of entries) {
    const variant = await prisma.motorcycleVariant.findUnique({ where: { id: entry.variantId } });
    if (!variant) {
      throw ApiError.badRequest(`Compatibility variant ${entry.variantId} does not exist`);
    }
  }
}

async function assertSkuAvailable(sku: string, excludeProductId?: string): Promise<void> {
  const existing = await prisma.product.findUnique({ where: { sku } });
  if (existing && existing.id !== excludeProductId) {
    throw new ApiError(409, 'DUPLICATE_SKU', `SKU "${sku}" is already in use`);
  }
}

async function assertIdentifiersAvailable(
  entries: IdentifierInput[],
  excludeProductId?: string,
): Promise<void> {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.type}:${entry.value}`;
    if (seen.has(key)) {
      throw new ApiError(
        409,
        'DUPLICATE_IDENTIFIER',
        `Identifier "${entry.value}" was provided more than once`,
      );
    }
    seen.add(key);
  }
  const existing = await prisma.productIdentifier.findMany({
    where: {
      OR: entries.map((entry) => ({ type: entry.type, value: entry.value })),
    },
    select: { productId: true, type: true, value: true },
  });
  const clash = existing.find((identifier) => identifier.productId !== excludeProductId);
  if (clash) {
    throw new ApiError(
      409,
      'DUPLICATE_IDENTIFIER',
      `Identifier "${clash.value}" is already used by another product`,
    );
  }
}

async function assertCompatibilityAvailable(
  entries: CompatibilityInput[],
  productId: string,
): Promise<void> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.variantId)) {
      throw new ApiError(
        409,
        'DUPLICATE_COMPATIBILITY',
        'A product cannot be linked to the same motorcycle twice',
      );
    }
    seen.add(entry.variantId);
  }
  const existing = await prisma.productCompatibility.findMany({
    where: { productId, variantId: { in: entries.map((entry) => entry.variantId) } },
    select: { variantId: true },
  });
  if (existing.length > 0) {
    throw new ApiError(
      409,
      'DUPLICATE_COMPATIBILITY',
      'This product is already linked to one of those motorcycles',
    );
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const SORT_FIELDS: Record<string, string> = {
  name: 'name',
  sku: 'sku',
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
  makeId?: string;
  modelId?: string;
  variantId?: string;
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
        { identifiers: { some: { value: { contains: query.q, mode: 'insensitive' } } } },
        { brand: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
        { category: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
      ],
    });
  }

  // Compatibility filters: products compatible with a specific motorcycle.
  if (query.variantId) and.push({ compatibilities: { some: { variantId: query.variantId } } });
  if (query.modelId) and.push({ compatibilities: { some: { variant: { modelId: query.modelId } } } });
  if (query.makeId) and.push({ compatibilities: { some: { variant: { model: { makeId: query.makeId } } } } });

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
    retailPrice: number;
    wholesalePrice: number;
    minimumStock: number;
    reorderLevel: number;
    status?: Status;
    identifiers?: IdentifierInput[];
    compatibility?: CompatibilityInput[];
  },
  ctx: { request: Request; actor: { id: string } },
): Promise<ProductDetail> {
  await resolveCategory(input.categoryId);
  await resolveBrand(input.brandId);
  await assertSkuAvailable(input.sku);
  const identifiers = input.identifiers ?? [];
  const compatibility = input.compatibility ?? [];
  if (identifiers.length > 0) await assertIdentifiersAvailable(identifiers);
  if (compatibility.length > 0) {
    await resolveVariants(compatibility);
    await assertCompatibilityAvailable(compatibility, '__new__');
  }

  const product = await prisma.product.create({
    data: {
      sku: input.sku.trim(),
      name: input.name.trim(),
      description: input.description ?? null,
      categoryId: input.categoryId,
      brandId: input.brandId ?? null,
      retailPrice: input.retailPrice,
      wholesalePrice: input.wholesalePrice,
      minimumStock: input.minimumStock,
      reorderLevel: input.reorderLevel,
      status: input.status ?? 'ACTIVE',
      identifiers: { create: identifiers.map((identifier) => ({ type: identifier.type, value: identifier.value })) },
      compatibilities: {
        create: compatibility.map((entry) => ({ variantId: entry.variantId, notes: entry.notes ?? null })),
      },
    },
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
      identifiers: identifiers.map((identifier) => ({ type: identifier.type, value: identifier.value })),
      compatibility: compatibility.map((entry) => entry.variantId),
    },
  });

  return toDetail(product);
}

export async function updateProduct(
  id: string,
  input: {
    sku?: string;
    name?: string;
    description?: string | null;
    categoryId?: string;
    brandId?: string | null;
    retailPrice?: number;
    wholesalePrice?: number;
    minimumStock?: number;
    reorderLevel?: number;
    status?: Status;
    identifiers?: IdentifierInput[];
    compatibility?: CompatibilityInput[];
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
  if (input.retailPrice !== undefined) data.retailPrice = input.retailPrice;
  if (input.wholesalePrice !== undefined) data.wholesalePrice = input.wholesalePrice;
  if (input.minimumStock !== undefined) data.minimumStock = input.minimumStock;
  if (input.reorderLevel !== undefined) data.reorderLevel = input.reorderLevel;
  if (input.status !== undefined) data.status = input.status;

  // Identifiers: full replace when the array is provided. Compute the diff for
  // granular audit events.
  let identifierAudit: { added: IdentifierInput[]; removed: { type: string; value: string }[] } | null = null;
  if (input.identifiers !== undefined) {
    if (input.identifiers.length > 0) {
      await assertIdentifiersAvailable(input.identifiers, id);
    }
    const current = await prisma.productIdentifier.findMany({
      where: { productId: id },
      select: { id: true, type: true, value: true },
    });
    const requestedKeys = new Set(input.identifiers.map((identifier) => `${identifier.type}:${identifier.value}`));
    const currentKeys = new Set(current.map((identifier) => `${identifier.type}:${identifier.value}`));
    const added = input.identifiers.filter((identifier) => !currentKeys.has(`${identifier.type}:${identifier.value}`));
    const removed = current.filter((identifier) => !requestedKeys.has(`${identifier.type}:${identifier.value}`));
    identifierAudit = { added, removed };
    data.identifiers = {
      deleteMany: {},
      create: input.identifiers.map((identifier) => ({ type: identifier.type, value: identifier.value })),
    };
  }

  // Compatibility: full replace when the array is provided.
  let compatibilityAudit: { added: CompatibilityInput[]; removed: { id: string; variantId: string }[] } | null = null;
  if (input.compatibility !== undefined) {
    if (input.compatibility.length > 0) {
      await resolveVariants(input.compatibility);
      await assertCompatibilityAvailable(input.compatibility, id);
    }
    const current = await prisma.productCompatibility.findMany({
      where: { productId: id },
      select: { id: true, variantId: true },
    });
    const requestedVariantIds = new Set(input.compatibility.map((entry) => entry.variantId));
    const added = input.compatibility.filter((entry) => !current.some((c) => c.variantId === entry.variantId));
    const removed = current.filter((c) => !requestedVariantIds.has(c.variantId));
    compatibilityAudit = { added, removed };
    data.compatibilities = {
      deleteMany: {},
      create: input.compatibility.map((entry) => ({ variantId: entry.variantId, notes: entry.notes ?? null })),
    };
  }

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
    },
    afterState: {
      sku: product.sku,
      name: product.name,
      categoryId: product.categoryId,
      brandId: product.brandId,
    },
  });

  for (const identifier of identifierAudit?.added ?? []) {
    await recordAudit({
      request: ctx.request,
      userId: ctx.actor.id,
      action: AUDIT.IDENTIFIER_ADDED,
      entityType: 'productIdentifier',
      entityId: id,
      afterState: { type: identifier.type, value: identifier.value },
    });
  }
  for (const identifier of identifierAudit?.removed ?? []) {
    await recordAudit({
      request: ctx.request,
      userId: ctx.actor.id,
      action: AUDIT.IDENTIFIER_REMOVED,
      entityType: 'productIdentifier',
      entityId: id,
      afterState: { type: identifier.type, value: identifier.value },
    });
  }
  for (const entry of compatibilityAudit?.added ?? []) {
    await recordAudit({
      request: ctx.request,
      userId: ctx.actor.id,
      action: AUDIT.COMPATIBILITY_ADDED,
      entityType: 'productCompatibility',
      entityId: id,
      afterState: { variantId: entry.variantId },
    });
  }
  for (const entry of compatibilityAudit?.removed ?? []) {
    await recordAudit({
      request: ctx.request,
      userId: ctx.actor.id,
      action: AUDIT.COMPATIBILITY_REMOVED,
      entityType: 'productCompatibility',
      entityId: id,
      afterState: { variantId: entry.variantId },
    });
  }

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