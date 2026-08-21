import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { ApiError } from '../middleware/error.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../utils/audit.js';
import { orderBy, paginate, type PaginationResult } from '../utils/pagination.js';
import { AUDIT } from '../constants/auditActions.js';

export type StatusInput = 'ACTIVE' | 'INACTIVE';

export interface BrandItem {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const include = { _count: { select: { products: true } } } satisfies Prisma.BrandInclude;

function toItem(brand: {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number };
}): BrandItem {
  return {
    id: brand.id,
    name: brand.name,
    status: brand.status,
    productCount: brand._count.products,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
  };
}

export async function listBrands(query: {
  q?: string;
  status?: StatusInput;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): Promise<PaginationResult<BrandItem>> {
  const where: Prisma.BrandWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, totalItems] = await Promise.all([
    prisma.brand.findMany({
      where,
      include,
      orderBy: orderBy(query.sortBy ?? 'name', query.sortOrder ?? 'asc', {
        name: 'name',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      }),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.brand.count({ where }),
  ]);

  return paginate(rows.map(toItem), page, pageSize, totalItems);
}

export async function getBrand(id: string): Promise<BrandItem> {
  const brand = await prisma.brand.findUnique({ where: { id }, include });
  if (!brand) throw ApiError.notFound('Brand not found');
  return toItem(brand);
}

export async function createBrand(
  input: { name: string },
  ctx: { request: Request; actor: { id: string } },
): Promise<BrandItem> {
  const name = input.name.trim();
  const existing = await prisma.brand.findUnique({ where: { name } });
  if (existing) {
    throw new ApiError(409, 'DUPLICATE_BRAND', `Brand "${name}" already exists`);
  }

  const brand = await prisma.brand.create({ data: { name }, include });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.BRAND_CREATED,
    entityType: 'brand',
    entityId: brand.id,
    afterState: { name: brand.name },
  });

  return toItem(brand);
}

export async function updateBrand(
  id: string,
  input: { name?: string },
  ctx: { request: Request; actor: { id: string } },
): Promise<BrandItem> {
  const existing = await prisma.brand.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Brand not found');

  const data: Prisma.BrandUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const clash = await prisma.brand.findUnique({ where: { name } });
    if (clash && clash.id !== id) {
      throw new ApiError(409, 'DUPLICATE_BRAND', `Brand "${name}" already exists`);
    }
    data.name = name;
  }

  const brand = await prisma.brand.update({ where: { id }, data, include });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.BRAND_UPDATED,
    entityType: 'brand',
    entityId: id,
    beforeState: { name: existing.name },
    afterState: { name: brand.name },
  });

  return toItem(brand);
}

export async function setBrandStatus(
  id: string,
  status: StatusInput,
  ctx: { request: Request; actor: { id: string } },
): Promise<BrandItem> {
  const existing = await prisma.brand.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Brand not found');

  if (status === 'INACTIVE' && existing.status === 'ACTIVE') {
    const referenced = await prisma.product.count({ where: { brandId: id } });
    if (referenced > 0) {
      throw new ApiError(
        400,
        'BRAND_IN_USE',
        'Cannot deactivate a brand that is still in use by products.',
      );
    }
  }

  const brand = await prisma.brand.update({ where: { id }, data: { status }, include });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: status === 'ACTIVE' ? AUDIT.BRAND_ACTIVATED : AUDIT.BRAND_DEACTIVATED,
    entityType: 'brand',
    entityId: id,
    afterState: { status },
  });

  return toItem(brand);
}