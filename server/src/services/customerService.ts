import { CustomerStatus, Prisma } from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { paginate } from '../utils/pagination.js';

type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
}

export interface Context {
  request?: Request;
  actor?: Actor;
}

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  notes: true,
  type: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

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

/** Loads an active customer for transactional use. Never call outside a tx. */
export async function requireActiveCustomer(tx: Tx, customerId: string) {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  }
  if (customer.status !== CustomerStatus.ACTIVE) {
    throw new ApiError(409, 'CUSTOMER_INACTIVE', 'Customer is not active');
  }
  return customer;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createCustomer(
  body: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
    type?: 'RETAIL' | 'WHOLESALE' | 'MECHANIC' | 'GARAGE' | 'BUSINESS' | 'OTHER';
  },
  context: Context,
) {
  const customer = await prisma.customer.create({
    data: {
      name: body.name,
      phone: body.phone ?? null,
      email: body.email ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      type: body.type ?? 'RETAIL',
    },
    select: customerSelect,
  });
  audit({
    action: AUDIT.CUSTOMER_CREATED,
    entityType: 'Customer',
    entityId: customer.id,
    afterState: { name: customer.name, type: customer.type },
    context,
  });
  return customer;
}

export async function updateCustomer(
  customerId: string,
  body: Partial<{
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    type: 'RETAIL' | 'WHOLESALE' | 'MECHANIC' | 'GARAGE' | 'BUSINESS' | 'OTHER';
  }>,
  context: Context,
) {
  const existing = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!existing) throw ApiError.notFound('Customer not found');

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
    },
    select: customerSelect,
  });
  audit({
    action: AUDIT.CUSTOMER_UPDATED,
    entityType: 'Customer',
    entityId: customer.id,
    beforeState: { name: existing.name, phone: existing.phone, email: existing.email, type: existing.type },
    afterState: { name: customer.name, phone: customer.phone, email: customer.email, type: customer.type },
    context,
  });
  return customer;
}

export async function setCustomerStatus(
  customerId: string,
  status: 'ACTIVE' | 'INACTIVE',
  context: Context,
) {
  const existing = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { creditAccount: { select: { outstandingBalance: true } } },
  });
  if (!existing) throw ApiError.notFound('Customer not found');
  if (existing.status === status) return existing;

  // A customer who owes money cannot be deactivated — the debt must remain
  // collectable through the normal credit workflow.
  if (
    status === CustomerStatus.INACTIVE &&
    existing.creditAccount &&
    new Prisma.Decimal(existing.creditAccount.outstandingBalance).greaterThan(0)
  ) {
    throw new ApiError(
      409,
      'CUSTOMER_HAS_OUTSTANDING_CREDIT',
      'Cannot deactivate a customer with an outstanding credit balance',
    );
  }

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: { status },
    select: customerSelect,
  });
  audit({
    action: status === CustomerStatus.ACTIVE ? AUDIT.CUSTOMER_ACTIVATED : AUDIT.CUSTOMER_DEACTIVATED,
    entityType: 'Customer',
    entityId: customer.id,
    beforeState: { status: existing.status },
    afterState: { status: customer.status },
    context,
  });
  return customer;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listCustomers(query: {
  q?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  type?: 'RETAIL' | 'WHOLESALE' | 'MECHANIC' | 'GARAGE' | 'BUSINESS' | 'OTHER';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}) {
  const where: Prisma.CustomerWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: 'insensitive' } },
      { phone: { contains: query.q, mode: 'insensitive' } },
      { email: { contains: query.q, mode: 'insensitive' } },
    ];
  }

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const sortBy = query.sortBy ?? 'createdAt';

  const [totalItems, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      select: {
        ...customerSelect,
        creditAccount: { select: { outstandingBalance: true, creditLimit: true, status: true } },
        _count: { select: { sales: true } },
      },
      orderBy: { [sortBy]: query.sortOrder ?? 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(rows, page, pageSize, totalItems);
}

export async function getCustomer(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      ...customerSelect,
      creditAccount: {
        select: {
          id: true,
          creditLimit: true,
          outstandingBalance: true,
          status: true,
          createdAt: true,
        },
      },
      _count: { select: { sales: true, returns: true } },
    },
  });
  if (!customer) throw ApiError.notFound('Customer not found');
  return customer;
}
