import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { ApiError } from '../middleware/error.js';
import prisma from '../lib/prisma.js';
import { recordAudit } from '../utils/audit.js';
import { orderBy, paginate, type PaginationResult } from '../utils/pagination.js';
import { AUDIT } from '../constants/auditActions.js';

type Status = 'ACTIVE' | 'INACTIVE';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface MakeItem {
  id: string;
  name: string;
  status: Status;
  modelCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MakeDetail extends MakeItem {
  models: { id: string; name: string; status: Status }[];
}

export interface ModelItem {
  id: string;
  makeId: string;
  name: string;
  status: Status;
  make: { id: string; name: string; status: Status };
  variantCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelDetail extends ModelItem {
  variants: { id: string; name: string; status: Status; yearFrom: number | null; yearTo: number | null }[];
}

export interface VariantItem {
  id: string;
  modelId: string;
  name: string;
  yearFrom: number | null;
  yearTo: number | null;
  status: Status;
  model: {
    id: string;
    name: string;
    status: Status;
    make: { id: string; name: string; status: Status };
  };
  compatibilityCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const makeInclude = { _count: { select: { models: true } } } satisfies Prisma.MotorcycleMakeInclude;
const makeDetailInclude = {
  models: { select: { id: true, name: true, status: true }, orderBy: { name: 'asc' } },
} satisfies Prisma.MotorcycleMakeInclude;

const modelInclude = {
  make: { select: { id: true, name: true, status: true } },
  _count: { select: { variants: true } },
} satisfies Prisma.MotorcycleModelInclude;

const modelDetailInclude = {
  make: { select: { id: true, name: true, status: true } },
  variants: {
    select: { id: true, name: true, status: true, yearFrom: true, yearTo: true },
    orderBy: { name: 'asc' },
  },
} satisfies Prisma.MotorcycleModelInclude;

const variantInclude = {
  model: {
    include: { make: { select: { id: true, name: true, status: true } } },
  },
  _count: { select: { products: true } },
} satisfies Prisma.MotorcycleVariantInclude;

// ---------------------------------------------------------------------------
// Makes
// ---------------------------------------------------------------------------

export async function listMakes(query: {
  q?: string;
  status?: Status;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): Promise<PaginationResult<MakeItem>> {
  const where: Prisma.MotorcycleMakeWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, totalItems] = await Promise.all([
    prisma.motorcycleMake.findMany({
      where,
      include: makeInclude,
      orderBy: orderBy(query.sortBy ?? 'name', query.sortOrder ?? 'asc', {
        name: 'name',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      }),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.motorcycleMake.count({ where }),
  ]);

  return paginate(
    rows.map((make) => ({
      id: make.id,
      name: make.name,
      status: make.status,
      modelCount: make._count.models,
      createdAt: make.createdAt,
      updatedAt: make.updatedAt,
    })),
    page,
    pageSize,
    totalItems,
  );
}

export async function getMake(id: string): Promise<MakeDetail> {
  const make = await prisma.motorcycleMake.findUnique({ where: { id }, include: makeDetailInclude });
  if (!make) throw ApiError.notFound('Motorcycle make not found');
  return {
    id: make.id,
    name: make.name,
    status: make.status,
    modelCount: make.models.length,
    createdAt: make.createdAt,
    updatedAt: make.updatedAt,
    models: make.models,
  };
}

export async function createMake(
  input: { name: string },
  ctx: { request: Request; actor: { id: string } },
): Promise<MakeItem> {
  const name = input.name.trim();
  const existing = await prisma.motorcycleMake.findUnique({ where: { name } });
  if (existing) {
    throw new ApiError(409, 'DUPLICATE_MAKE', `Motorcycle make "${name}" already exists`);
  }
  const make = await prisma.motorcycleMake.create({ data: { name }, include: makeInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.MOTORCYCLE_MAKE_CREATED,
    entityType: 'motorcycleMake',
    entityId: make.id,
    afterState: { name: make.name },
  });

  return {
    id: make.id,
    name: make.name,
    status: make.status,
    modelCount: 0,
    createdAt: make.createdAt,
    updatedAt: make.updatedAt,
  };
}

export async function updateMake(
  id: string,
  input: { name?: string },
  ctx: { request: Request; actor: { id: string } },
): Promise<MakeItem> {
  const existing = await prisma.motorcycleMake.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Motorcycle make not found');

  const data: Prisma.MotorcycleMakeUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const clash = await prisma.motorcycleMake.findUnique({ where: { name } });
    if (clash && clash.id !== id) {
      throw new ApiError(409, 'DUPLICATE_MAKE', `Motorcycle make "${name}" already exists`);
    }
    data.name = name;
  }

  const make = await prisma.motorcycleMake.update({ where: { id }, data, include: makeInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.MOTORCYCLE_MAKE_UPDATED,
    entityType: 'motorcycleMake',
    entityId: id,
    beforeState: { name: existing.name },
    afterState: { name: make.name },
  });

  return {
    id: make.id,
    name: make.name,
    status: make.status,
    modelCount: make._count.models,
    createdAt: make.createdAt,
    updatedAt: make.updatedAt,
  };
}

export async function setMakeStatus(
  id: string,
  status: Status,
  ctx: { request: Request; actor: { id: string } },
): Promise<MakeItem> {
  const existing = await prisma.motorcycleMake.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Motorcycle make not found');

  if (status === 'INACTIVE' && existing.status === 'ACTIVE') {
    const used = await prisma.productCompatibility.count({
      where: { variant: { model: { makeId: id } } },
    });
    if (used > 0) {
      throw new ApiError(
        400,
        'MOTORCYCLE_IN_USE',
        'Cannot deactivate a make that is used by product compatibility records.',
      );
    }
  }

  const make = await prisma.motorcycleMake.update({ where: { id }, data: { status }, include: makeInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: status === 'ACTIVE' ? AUDIT.MOTORCYCLE_MAKE_ACTIVATED : AUDIT.MOTORCYCLE_MAKE_DEACTIVATED,
    entityType: 'motorcycleMake',
    entityId: id,
    afterState: { status },
  });

  return {
    id: make.id,
    name: make.name,
    status: make.status,
    modelCount: make._count.models,
    createdAt: make.createdAt,
    updatedAt: make.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function listModels(query: {
  q?: string;
  status?: Status;
  makeId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): Promise<PaginationResult<ModelItem>> {
  const where: Prisma.MotorcycleModelWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.makeId) where.makeId = query.makeId;
  if (query.q) where.name = { contains: query.q, mode: 'insensitive' };

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, totalItems] = await Promise.all([
    prisma.motorcycleModel.findMany({
      where,
      include: modelInclude,
      orderBy: orderBy(query.sortBy ?? 'name', query.sortOrder ?? 'asc', {
        name: 'name',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      }),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.motorcycleModel.count({ where }),
  ]);

  return paginate(
    rows.map((model) => ({
      id: model.id,
      makeId: model.makeId,
      name: model.name,
      status: model.status,
      make: model.make,
      variantCount: model._count.variants,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    })),
    page,
    pageSize,
    totalItems,
  );
}

export async function getModel(id: string): Promise<ModelDetail> {
  const model = await prisma.motorcycleModel.findUnique({ where: { id }, include: modelDetailInclude });
  if (!model) throw ApiError.notFound('Motorcycle model not found');
  return {
    id: model.id,
    makeId: model.makeId,
    name: model.name,
    status: model.status,
    make: model.make,
    variantCount: model.variants.length,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    variants: model.variants,
  };
}

async function resolveMake(makeId: string): Promise<void> {
  const make = await prisma.motorcycleMake.findUnique({ where: { id: makeId } });
  if (!make) throw ApiError.badRequest('Motorcycle make does not exist');
}

export async function createModel(
  input: { makeId: string; name: string },
  ctx: { request: Request; actor: { id: string } },
): Promise<ModelItem> {
  await resolveMake(input.makeId);
  const name = input.name.trim();
  const existing = await prisma.motorcycleModel.findUnique({
    where: { makeId_name: { makeId: input.makeId, name } },
  });
  if (existing) {
    throw new ApiError(
      409,
      'DUPLICATE_MODEL',
      `Model "${name}" already exists for this make`,
    );
  }
  const model = await prisma.motorcycleModel.create({
    data: { makeId: input.makeId, name },
    include: modelInclude,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.MOTORCYCLE_MODEL_CREATED,
    entityType: 'motorcycleModel',
    entityId: model.id,
    afterState: { makeId: model.makeId, name: model.name },
  });

  return {
    id: model.id,
    makeId: model.makeId,
    name: model.name,
    status: model.status,
    make: model.make,
    variantCount: 0,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export async function updateModel(
  id: string,
  input: { name?: string },
  ctx: { request: Request; actor: { id: string } },
): Promise<ModelItem> {
  const existing = await prisma.motorcycleModel.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Motorcycle model not found');

  const data: Prisma.MotorcycleModelUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const clash = await prisma.motorcycleModel.findUnique({
      where: { makeId_name: { makeId: existing.makeId, name } },
    });
    if (clash && clash.id !== id) {
      throw new ApiError(
        409,
        'DUPLICATE_MODEL',
        `Model "${name}" already exists for this make`,
      );
    }
    data.name = name;
  }

  const model = await prisma.motorcycleModel.update({ where: { id }, data, include: modelInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.MOTORCYCLE_MODEL_UPDATED,
    entityType: 'motorcycleModel',
    entityId: id,
    beforeState: { name: existing.name },
    afterState: { name: model.name },
  });

  return {
    id: model.id,
    makeId: model.makeId,
    name: model.name,
    status: model.status,
    make: model.make,
    variantCount: model._count.variants,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export async function setModelStatus(
  id: string,
  status: Status,
  ctx: { request: Request; actor: { id: string } },
): Promise<ModelItem> {
  const existing = await prisma.motorcycleModel.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Motorcycle model not found');

  if (status === 'INACTIVE' && existing.status === 'ACTIVE') {
    const used = await prisma.productCompatibility.count({
      where: { variant: { modelId: id } },
    });
    if (used > 0) {
      throw new ApiError(
        400,
        'MOTORCYCLE_IN_USE',
        'Cannot deactivate a model that is used by product compatibility records.',
      );
    }
  }

  const model = await prisma.motorcycleModel.update({ where: { id }, data: { status }, include: modelInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: status === 'ACTIVE' ? AUDIT.MOTORCYCLE_MODEL_ACTIVATED : AUDIT.MOTORCYCLE_MODEL_DEACTIVATED,
    entityType: 'motorcycleModel',
    entityId: id,
    afterState: { status },
  });

  return {
    id: model.id,
    makeId: model.makeId,
    name: model.name,
    status: model.status,
    make: model.make,
    variantCount: model._count.variants,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

export async function listVariants(query: {
  q?: string;
  status?: Status;
  makeId?: string;
  modelId?: string;
  make?: string;
  model?: string;
  variant?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}): Promise<PaginationResult<VariantItem>> {
  const where: Prisma.MotorcycleVariantWhereInput = {};
  const and: Prisma.MotorcycleVariantWhereInput[] = [];

  if (query.status) and.push({ status: query.status });
  if (query.modelId) and.push({ modelId: query.modelId });
  if (query.makeId) and.push({ model: { is: { makeId: query.makeId } } });
  if (query.q) and.push({ name: { contains: query.q, mode: 'insensitive' } });
  // Free-text compatibility search across make/model/variant names.
  if (query.make) {
    and.push({
      model: { is: { make: { is: { name: { contains: query.make, mode: 'insensitive' } } } } },
    });
  }
  if (query.model) {
    and.push({ model: { is: { name: { contains: query.model, mode: 'insensitive' } } } });
  }
  if (query.variant) {
    and.push({ name: { contains: query.variant, mode: 'insensitive' } });
  }

  if (and.length > 0) where.AND = and;

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;

  const [rows, totalItems] = await Promise.all([
    prisma.motorcycleVariant.findMany({
      where,
      include: variantInclude,
      orderBy: orderBy(query.sortBy ?? 'name', query.sortOrder ?? 'asc', {
        name: 'name',
        yearFrom: 'yearFrom',
        yearTo: 'yearTo',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      }),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.motorcycleVariant.count({ where }),
  ]);

  return paginate(
    rows.map((variant) => ({
      id: variant.id,
      modelId: variant.modelId,
      name: variant.name,
      yearFrom: variant.yearFrom,
      yearTo: variant.yearTo,
      status: variant.status,
      model: variant.model,
      compatibilityCount: variant._count.products,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    })),
    page,
    pageSize,
    totalItems,
  );
}

export async function getVariant(id: string): Promise<VariantItem> {
  const variant = await prisma.motorcycleVariant.findUnique({ where: { id }, include: variantInclude });
  if (!variant) throw ApiError.notFound('Motorcycle variant not found');
  return {
    id: variant.id,
    modelId: variant.modelId,
    name: variant.name,
    yearFrom: variant.yearFrom,
    yearTo: variant.yearTo,
    status: variant.status,
    model: variant.model,
    compatibilityCount: variant._count.products,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

async function resolveModel(modelId: string): Promise<void> {
  const model = await prisma.motorcycleModel.findUnique({ where: { id: modelId } });
  if (!model) throw ApiError.badRequest('Motorcycle model does not exist');
}

function assertYearRange(yearFrom: number | null | undefined, yearTo: number | null | undefined): void {
  if (
    yearFrom != null &&
    yearTo != null &&
    yearTo > 0 &&
    yearFrom > yearTo
  ) {
    throw ApiError.badRequest('yearFrom cannot be after yearTo');
  }
}

export async function createVariant(
  input: { modelId: string; name: string; yearFrom?: number | null; yearTo?: number | null },
  ctx: { request: Request; actor: { id: string } },
): Promise<VariantItem> {
  await resolveModel(input.modelId);
  assertYearRange(input.yearFrom, input.yearTo);
  const name = input.name.trim();
  const existing = await prisma.motorcycleVariant.findUnique({
    where: { modelId_name: { modelId: input.modelId, name } },
  });
  if (existing) {
    throw new ApiError(
      409,
      'DUPLICATE_VARIANT',
      `Variant "${name}" already exists for this model`,
    );
  }
  const variant = await prisma.motorcycleVariant.create({
    data: {
      modelId: input.modelId,
      name,
      yearFrom: input.yearFrom ?? null,
      yearTo: input.yearTo ?? null,
    },
    include: variantInclude,
  });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.MOTORCYCLE_VARIANT_CREATED,
    entityType: 'motorcycleVariant',
    entityId: variant.id,
    afterState: { modelId: variant.modelId, name: variant.name },
  });

  return {
    id: variant.id,
    modelId: variant.modelId,
    name: variant.name,
    yearFrom: variant.yearFrom,
    yearTo: variant.yearTo,
    status: variant.status,
    model: variant.model,
    compatibilityCount: 0,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

export async function updateVariant(
  id: string,
  input: { name?: string; yearFrom?: number | null; yearTo?: number | null },
  ctx: { request: Request; actor: { id: string } },
): Promise<VariantItem> {
  const existing = await prisma.motorcycleVariant.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Motorcycle variant not found');

  const yearFrom = input.yearFrom !== undefined ? input.yearFrom : existing.yearFrom;
  const yearTo = input.yearTo !== undefined ? input.yearTo : existing.yearTo;
  assertYearRange(yearFrom, yearTo);

  const data: Prisma.MotorcycleVariantUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    const clash = await prisma.motorcycleVariant.findUnique({
      where: { modelId_name: { modelId: existing.modelId, name } },
    });
    if (clash && clash.id !== id) {
      throw new ApiError(
        409,
        'DUPLICATE_VARIANT',
        `Variant "${name}" already exists for this model`,
      );
    }
    data.name = name;
  }
  if (input.yearFrom !== undefined) data.yearFrom = input.yearFrom ?? null;
  if (input.yearTo !== undefined) data.yearTo = input.yearTo ?? null;

  const variant = await prisma.motorcycleVariant.update({ where: { id }, data, include: variantInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: AUDIT.MOTORCYCLE_VARIANT_UPDATED,
    entityType: 'motorcycleVariant',
    entityId: id,
    beforeState: { name: existing.name, yearFrom: existing.yearFrom, yearTo: existing.yearTo },
    afterState: { name: variant.name, yearFrom: variant.yearFrom, yearTo: variant.yearTo },
  });

  return {
    id: variant.id,
    modelId: variant.modelId,
    name: variant.name,
    yearFrom: variant.yearFrom,
    yearTo: variant.yearTo,
    status: variant.status,
    model: variant.model,
    compatibilityCount: variant._count.products,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

export async function setVariantStatus(
  id: string,
  status: Status,
  ctx: { request: Request; actor: { id: string } },
): Promise<VariantItem> {
  const existing = await prisma.motorcycleVariant.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound('Motorcycle variant not found');

  if (status === 'INACTIVE' && existing.status === 'ACTIVE') {
    const used = await prisma.productCompatibility.count({ where: { variantId: id } });
    if (used > 0) {
      throw new ApiError(
        400,
        'MOTORCYCLE_IN_USE',
        'Cannot deactivate a variant that is used by product compatibility records.',
      );
    }
  }

  const variant = await prisma.motorcycleVariant.update({ where: { id }, data: { status }, include: variantInclude });

  await recordAudit({
    request: ctx.request,
    userId: ctx.actor.id,
    action: status === 'ACTIVE' ? AUDIT.MOTORCYCLE_VARIANT_ACTIVATED : AUDIT.MOTORCYCLE_VARIANT_DEACTIVATED,
    entityType: 'motorcycleVariant',
    entityId: id,
    afterState: { status },
  });

  return {
    id: variant.id,
    modelId: variant.modelId,
    name: variant.name,
    yearFrom: variant.yearFrom,
    yearTo: variant.yearTo,
    status: variant.status,
    model: variant.model,
    compatibilityCount: variant._count.products,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}