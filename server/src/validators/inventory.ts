import { InventoryTransactionType, ReservationStatus } from '@prisma/client';
import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  sortSchema,
} from './catalog.js';

const page = z.coerce.number().int().positive();
const pageSize = z.coerce.number().int().positive().max(MAX_PAGE_SIZE);

const productStatus = z.enum(['ACTIVE', 'INACTIVE']);
const transactionType = z.nativeEnum(InventoryTransactionType);

export const inventoryListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1).max(128).optional(),
  status: productStatus.optional(),
  stockStatus: z.enum(['HEALTHY', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
  ...sortSchema(
    ['name', 'sku', 'quantityOnHand', 'quantityReserved', 'available', 'weightedAverageCost', 'inventoryValue', 'updatedAt'],
    'name',
  ),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const lowStockQuery = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1).max(128).optional(),
  stockStatus: z.enum(['LOW_STOCK', 'OUT_OF_STOCK']).optional(),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const idParamSchema = z.object({
  id: z.string().min(1).max(128),
});

export const productIdParamSchema = z.object({
  productId: z.string().min(1).max(128),
});

export const inventoryAdjustSchema = z.object({
  quantity: z
    .number({ invalid_type_error: 'Quantity must be a number' })
    .int('Quantity must be an integer')
    .refine((v) => v !== 0, 'Quantity must be non-zero'),
  reason: z.string().trim().min(1).max(500),
  type: z.enum(['ADJUSTMENT', 'DAMAGE', 'LOSS']).default('ADJUSTMENT'),
});

export const reservationCreateSchema = z.object({
  productId: z.string().min(1).max(128),
  quantity: z.number({ invalid_type_error: 'Quantity must be a number' }).int('Quantity must be an integer').positive('Quantity must be positive'),
  reservedUntil: z
    .string()
    .datetime({ message: 'reservedUntil must be an ISO-8601 date' })
    .optional()
    .nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const reservationListQuery = z.object({
  status: z.nativeEnum(ReservationStatus).optional(),
  productId: z.string().min(1).max(128).optional(),
  ...sortSchema(['createdAt', 'reservedUntil', 'quantity', 'status'], 'createdAt'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const transactionListQuery = z.object({
  type: transactionType.optional(),
  movement: z.enum(['in', 'out', 'reservation']).optional(),
  userId: z.string().min(1).max(128).optional(),
  from: z.string().datetime({ message: 'from must be an ISO-8601 date' }).optional(),
  to: z.string().datetime({ message: 'to must be an ISO-8601 date' }).optional(),
  ...sortSchema(['createdAt', 'quantity', 'balanceAfter'], 'createdAt'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});
