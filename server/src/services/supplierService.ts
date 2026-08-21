import { SupplierProductStatus, SupplierStatus } from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { orderBy, paginate } from '../utils/pagination.js';

interface Actor {
  id: string;
}

interface Context {
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

async function ensureSupplier(supplierId: string): Promise<{
  id: string;
  name: string;
  status: SupplierStatus;
}> {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    throw new ApiError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  }
  return supplier;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function listSuppliers(query: {
  q?: string;
  status?: SupplierStatus;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const where = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { contactPerson: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q, mode: 'insensitive' as const } },
            { email: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [totalItems, items] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: orderBy(query.sortBy ?? 'name', query.sortOrder ?? 'asc', {
        name: 'name',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      }),
      include: {
        creditAccount: { select: { outstandingBalance: true, status: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(items, page, pageSize, totalItems);
}

export async function getSupplier(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      products: {
        where: { status: SupplierProductStatus.ACTIVE },
        include: { product: { select: { id: true, sku: true, name: true, status: true } } },
        orderBy: [{ isPreferred: 'desc' }, { createdAt: 'desc' }],
      },
      creditAccount: true,
      _count: { select: { purchaseOrders: true, purchases: true } },
    },
  });
  if (!supplier) {
    throw new ApiError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  }
  return supplier;
}

export async function createSupplier(
  body: {
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
  },
  context: Context,
) {
  const supplier = await prisma.supplier.create({
    data: {
      name: body.name,
      contactPerson: body.contactPerson ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
    },
  });
  audit({
    action: AUDIT.SUPPLIER_CREATED,
    entityType: 'Supplier',
    entityId: supplier.id,
    afterState: { name: supplier.name, status: supplier.status },
    context,
  });
  return supplier;
}

export async function updateSupplier(
  supplierId: string,
  body: {
    name?: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
  },
  context: Context,
) {
  const existing = await ensureSupplier(supplierId);
  const supplier = await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.contactPerson !== undefined ? { contactPerson: body.contactPerson } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });
  audit({
    action: AUDIT.SUPPLIER_UPDATED,
    entityType: 'Supplier',
    entityId: supplierId,
    beforeState: { name: existing.name },
    afterState: { name: supplier.name, status: supplier.status },
    context,
  });
  return supplier;
}

export async function setSupplierStatus(
  supplierId: string,
  status: SupplierStatus,
  context: Context,
) {
  const existing = await ensureSupplier(supplierId);
  const supplier = await prisma.supplier.update({
    where: { id: supplierId },
    data: { status },
  });
  audit({
    action: status === SupplierStatus.ACTIVE ? AUDIT.SUPPLIER_ACTIVATED : AUDIT.SUPPLIER_DEACTIVATED,
    entityType: 'Supplier',
    entityId: supplierId,
    beforeState: { status: existing.status },
    afterState: { status: supplier.status },
    context,
  });
  return supplier;
}

// ---------------------------------------------------------------------------
// Supplier products
// ---------------------------------------------------------------------------

export async function listSupplierProducts(supplierId: string, query: { status?: SupplierProductStatus; q?: string }) {
  await ensureSupplier(supplierId);
  const where = {
    supplierId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { supplierPartNumber: { contains: query.q, mode: 'insensitive' as const } },
            { product: { name: { contains: query.q, mode: 'insensitive' as const } } },
            { product: { sku: { contains: query.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
  return prisma.supplierProduct.findMany({
    where,
    include: { product: { select: { id: true, sku: true, name: true, status: true } } },
    orderBy: [{ isPreferred: 'desc' }, { status: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function linkSupplierProduct(
  supplierId: string,
  body: {
    productId: string;
    supplierPartNumber?: string | null;
    unitCost?: number | null;
    notes?: string | null;
    isPreferred?: boolean;
    status?: SupplierProductStatus;
  },
  context: Context,
) {
  const supplier = await ensureSupplier(supplierId);
  if (supplier.status !== SupplierStatus.ACTIVE) {
    throw new ApiError(409, 'SUPPLIER_INACTIVE', 'Cannot link products to an inactive supplier');
  }

  const product = await prisma.product.findUnique({ where: { id: body.productId } });
  if (!product) {
    throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  }
  if (product.status !== 'ACTIVE') {
    throw new ApiError(409, 'PRODUCT_INACTIVE', 'Cannot link an inactive product');
  }

  const existing = await prisma.supplierProduct.findUnique({
    where: { supplierId_productId: { supplierId, productId: body.productId } },
  });
  if (existing) {
    throw new ApiError(409, 'SUPPLIER_PRODUCT_EXISTS', 'Product is already linked to this supplier');
  }

  const link = await prisma.supplierProduct.create({
    data: {
      supplierId,
      productId: body.productId,
      supplierPartNumber: body.supplierPartNumber ?? null,
      unitCost: body.unitCost ?? null,
      notes: body.notes ?? null,
      isPreferred: body.isPreferred ?? false,
      status: body.status ?? SupplierProductStatus.ACTIVE,
    },
  });

  audit({
    action: AUDIT.SUPPLIER_PRODUCT_LINKED,
    entityType: 'SupplierProduct',
    entityId: link.id,
    afterState: { supplierId, productId: body.productId, supplierPartNumber: link.supplierPartNumber, unitCost: link.unitCost ? Number(link.unitCost) : null },
    context,
  });
  return link;
}

export async function updateSupplierProduct(
  linkId: string,
  body: {
    supplierPartNumber?: string | null;
    unitCost?: number | null;
    notes?: string | null;
    isPreferred?: boolean;
    status?: SupplierProductStatus;
  },
  context: Context,
) {
  const existing = await prisma.supplierProduct.findUnique({ where: { id: linkId } });
  if (!existing) {
    throw new ApiError(404, 'SUPPLIER_PRODUCT_NOT_FOUND', 'Supplier product link not found');
  }
  const link = await prisma.supplierProduct.update({
    where: { id: linkId },
    data: {
      ...(body.supplierPartNumber !== undefined ? { supplierPartNumber: body.supplierPartNumber } : {}),
      ...(body.unitCost !== undefined ? { unitCost: body.unitCost } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.isPreferred !== undefined ? { isPreferred: body.isPreferred } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    },
  });
  audit({
    action: AUDIT.SUPPLIER_PRODUCT_UPDATED,
    entityType: 'SupplierProduct',
    entityId: linkId,
    beforeState: { isPreferred: existing.isPreferred, status: existing.status },
    afterState: { isPreferred: link.isPreferred, status: link.status, unitCost: link.unitCost ? Number(link.unitCost) : null },
    context,
  });
  return link;
}

export async function unlinkSupplierProduct(linkId: string, context: Context) {
  const existing = await prisma.supplierProduct.findUnique({ where: { id: linkId } });
  if (!existing) {
    throw new ApiError(404, 'SUPPLIER_PRODUCT_NOT_FOUND', 'Supplier product link not found');
  }
  await prisma.supplierProduct.delete({ where: { id: linkId } });
  audit({
    action: AUDIT.SUPPLIER_PRODUCT_UNLINKED,
    entityType: 'SupplierProduct',
    entityId: linkId,
    beforeState: { supplierId: existing.supplierId, productId: existing.productId },
    context,
  });
  return { id: linkId, unlinked: true };
}