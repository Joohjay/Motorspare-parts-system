import type { Request } from 'express';

import { ApiError } from '../middleware/error.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../utils/audit.js';
import { AUDIT } from '../constants/auditActions.js';

export interface CompatibilityDetail {
  id: string;
  productId: string;
  variantId: string;
  notes: string | null;
  createdAt: Date;
  variant: {
    id: string;
    name: string;
    yearFrom: number | null;
    yearTo: number | null;
    model: {
      id: string;
      name: string;
      make: { id: string; name: string };
    };
  };
  product: {
    id: string;
    sku: string;
    name: string;
    status: string;
  };
}

const include = {
  variant: {
    include: { model: { include: { make: { select: { id: true, name: true } } } } },
  },
  product: { select: { id: true, sku: true, name: true, status: true } },
} as const;

/**
 * Adds a product <-> motorcycle-variant link. The (productId, variantId) pair
 * is unique, so a link can never be inserted twice.
 */
export async function addCompatibility(
  input: { productId: string; variantId: string; notes?: string | null },
  ctx: { request: Request; actor: { id: string } },
): Promise<CompatibilityDetail> {
  const [product, variant] = await Promise.all([
    prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } }),
    prisma.motorcycleVariant.findUnique({ where: { id: input.variantId }, select: { id: true } }),
  ]);
  if (!product) throw ApiError.notFound('Product not found');
  if (!variant) throw ApiError.badRequest('Motorcycle variant does not exist');

  const existing = await prisma.productCompatibility.findUnique({
    where: { productId_variantId: { productId: input.productId, variantId: input.variantId } },
  });
  if (existing) {
    throw new ApiError(
      409,
      'DUPLICATE_COMPATIBILITY',
      'This product is already linked to that motorcycle variant',
    );
  }

  const compatibility = await prisma.productCompatibility.create({
    data: {
      productId: input.productId,
      variantId: input.variantId,
      notes: input.notes ?? null,
    },
    include,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.COMPATIBILITY_ADDED,
    entityType: 'productCompatibility',
    entityId: compatibility.id,
    afterState: { productId: compatibility.productId, variantId: compatibility.variantId },
  });

  return compatibility;
}

export async function removeCompatibility(
  id: string,
  ctx: { request: Request; actor: { id: string } },
): Promise<void> {
  const existing = await prisma.productCompatibility.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Compatibility link not found');

  await prisma.productCompatibility.delete({ where: { id } });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.COMPATIBILITY_REMOVED,
    entityType: 'productCompatibility',
    entityId: id,
    afterState: { productId: existing.productId, variantId: existing.variantId },
  });
}

/** Reverse lookup: every compatibility link attached to a product. */
export async function listCompatibilityForProduct(productId: string): Promise<CompatibilityDetail[]> {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw ApiError.notFound('Product not found');
  return prisma.productCompatibility.findMany({
    where: { productId },
    include,
    orderBy: { createdAt: 'desc' },
  });
}