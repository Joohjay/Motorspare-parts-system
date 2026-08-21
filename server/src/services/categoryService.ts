import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { ApiError } from '../middleware/error.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../utils/audit.js';
import { slugify } from '../utils/slug.js';
import { orderBy, paginate, type PaginationResult } from '../utils/pagination.js';
import { AUDIT } from '../constants/auditActions.js';

export type StatusInput = 'ACTIVE' | 'INACTIVE';

export interface CategoryListItem {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  productCount: number;
  childCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryDetail extends CategoryListItem {
  parent: { id: string; name: string; slug: string; status: string } | null;
  children: { id: string; name: string; slug: string; status: string }[];
}

const listInclude = {
  _count: { select: { products: true, children: true } },
} satisfies Prisma.CategoryInclude;

const detailInclude = {
  parent: { select: { id: true, name: true, slug: true, status: true } },
  children: { select: { id: true, name: true, slug: true, status: true } },
  _count: { select: { products: true, children: true } },
} satisfies Prisma.CategoryInclude;

function toListItem(category: {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number; children: number };
}): CategoryListItem {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    parentId: category.parentId,
    description: category.description,
    status: category.status,
    productCount: category._count.products,
    childCount: category._count.children,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

export async function listCategories(
  query: {
    q?: string;
    status?: StatusInput;
    parentId?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  },
): Promise<PaginationResult<CategoryListItem>> {
  const where: Prisma.CategoryWhereInput = {};
  if (query.parentId === 'root' || query.parentId === null) {
    where.parentId = null;
  } else if (query.parentId) {
    where.parentId = query.parentId;
  }
  if (query.status) where.status = query.status;
  if (query.q) {
    where.OR = [{ name: { contains: query.q, mode: 'insensitive' } }];
  }

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, totalItems] = await Promise.all([
    prisma.category.findMany({
      where,
      include: listInclude,
      orderBy: orderBy(query.sortBy ?? 'name', query.sortOrder ?? 'asc', {
        name: 'name',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      }),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.category.count({ where }),
  ]);

  return paginate(rows.map(toListItem), page, pageSize, totalItems);
}

export async function getCategory(id: string): Promise<CategoryDetail> {
  const category = await prisma.category.findUnique({ where: { id }, include: detailInclude });
  if (!category) throw ApiError.notFound('Category not found');
  return {
    ...toListItem(category),
    parent: category.parent,
    children: category.children,
  };
}

/** Derives a globally unique slug for a category name, appending a suffix on collision. */
async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || 'category';
  let candidate = base;
  let n = 2;
  for (;;) {
    const existing = await prisma.category.findUnique({ where: { slug: candidate } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

async function resolveParent(parentId: string | null | undefined): Promise<void> {
  if (!parentId) return;
  const parent = await prisma.category.findUnique({ where: { id: parentId } });
  if (!parent) throw ApiError.badRequest('Parent category does not exist');
}

/**
 * Rejects a parent assignment that would create a cycle (the category becoming
 * its own ancestor). Walks up the parent chain of the proposed parent.
 */
async function wouldCreateCycle(categoryId: string, parentId: string): Promise<boolean> {
  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === categoryId) return true;
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    const parent: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!parent) return true;
    cursor = parent.parentId;
  }
  return false;
}

async function assertNameAvailable(
  name: string,
  parentId: string | null,
  excludeId?: string,
): Promise<void> {
  const clash = await prisma.category.findFirst({
    where: { name, parentId },
  });
  if (clash && clash.id !== excludeId) {
    throw new ApiError(409, 'DUPLICATE_CATEGORY', `Category "${name}" already exists here`);
  }
}

export async function createCategory(
  input: { name: string; parentId?: string | null; description?: string | null },
  ctx: { request: Request; actor: { id: string } },
): Promise<CategoryDetail> {
  await resolveParent(input.parentId);
  const parentId = input.parentId ?? null;
  await assertNameAvailable(input.name, parentId);
  const slug = await uniqueSlug(input.name);
  const category = await prisma.category.create({
    data: {
      name: input.name.trim(),
      slug,
      parentId,
      description: input.description ?? null,
    },
    include: detailInclude,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.CATEGORY_CREATED,
    entityType: 'category',
    entityId: category.id,
    afterState: { name: category.name, parentId: category.parentId, slug: category.slug },
  });

  return { ...toListItem(category), parent: category.parent, children: category.children };
}

export async function updateCategory(
  id: string,
  input: { name?: string; parentId?: string | null; description?: string | null },
  ctx: { request: Request; actor: { id: string } },
): Promise<CategoryDetail> {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Category not found');

  if (input.parentId) {
    await resolveParent(input.parentId);
    if (input.parentId === id || (await wouldCreateCycle(id, input.parentId))) {
      throw ApiError.badRequest('A category cannot be moved under itself or one of its children');
    }
  }

  const data: Prisma.CategoryUncheckedUpdateInput = {};
  if (input.name !== undefined) {
    const parentId = input.parentId !== undefined ? (input.parentId ?? null) : existing.parentId;
    await assertNameAvailable(input.name, parentId, id);
    data.name = input.name.trim();
    data.slug = await uniqueSlug(input.name, id);
  }
  if (input.parentId !== undefined) data.parentId = input.parentId ?? null;
  if (input.description !== undefined) data.description = input.description ?? null;

  const category = await prisma.category.update({
    where: { id },
    data,
    include: detailInclude,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.CATEGORY_UPDATED,
    entityType: 'category',
    entityId: id,
    beforeState: {
      name: existing.name,
      parentId: existing.parentId,
      description: existing.description,
    },
    afterState: { name: category.name, parentId: category.parentId, description: category.description },
  });

  return { ...toListItem(category), parent: category.parent, children: category.children };
}

export async function setCategoryStatus(
  id: string,
  status: StatusInput,
  ctx: { request: Request; actor: { id: string } },
): Promise<CategoryDetail> {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Category not found');

  if (status === 'INACTIVE' && existing.status === 'ACTIVE') {
    const referenced = await prisma.product.count({ where: { categoryId: id } });
    if (referenced > 0) {
      throw new ApiError(
        400,
        'CATEGORY_IN_USE',
        'Cannot deactivate a category that is still in use by products.',
      );
    }
  }

  const category = await prisma.category.update({
    where: { id },
    data: { status },
    include: detailInclude,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: status === 'ACTIVE' ? AUDIT.CATEGORY_ACTIVATED : AUDIT.CATEGORY_DEACTIVATED,
    entityType: 'category',
    entityId: id,
    afterState: { status },
  });

  return { ...toListItem(category), parent: category.parent, children: category.children };
}