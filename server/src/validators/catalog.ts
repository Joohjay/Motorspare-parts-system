import { z } from 'zod';

export const MAX_PAGE_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 25;

export const idParamSchema = z.object({
  id: z.string().min(1).max(128),
});

export const statusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const statusUpdateSchema = z.object({
  status: statusSchema,
});

const pageSize = z.coerce.number().int().positive().max(MAX_PAGE_SIZE);
const page = z.coerce.number().int().positive();

export function sortSchema(fields: readonly [string, ...string[]], defaultBy: string) {
  return {
    sortBy: z.enum(fields).default(defaultBy),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
  };
}

// ---------------------------------------------------------------------------
// Named catalog entities (brands)
// ---------------------------------------------------------------------------

export const nameField = z.string().trim().min(1).max(120, 'Name is too long');
export const descriptionField = z.string().trim().max(500, 'Description is too long');

export const namedListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: statusSchema.optional(),
  ...sortSchema(['name', 'createdAt', 'updatedAt'], 'name'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const brandCreateSchema = z.object({
  name: nameField,
});

export const brandUpdateSchema = z.object({
  name: nameField.optional(),
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const productBaseFields = {
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  categoryId: z.string().min(1, 'Category is required').max(128),
  brandId: z.string().min(1).max(128).optional().nullable(),
  costPrice: z.coerce.number().min(0, 'Cost price cannot be negative').max(1_000_000_000),
  retailPrice: z.coerce.number().min(0, 'Retail price cannot be negative').max(1_000_000_000),
  wholesalePrice: z.coerce
    .number()
    .min(0, 'Wholesale price cannot be negative')
    .max(1_000_000_000),
  minimumStock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000).default(0),
  status: statusSchema.default('ACTIVE'),
};

export const productCreateSchema = z.object({
  ...productBaseFields,
  quantityOnHand: z.coerce
    .number()
    .int('Quantity must be a whole number')
    .min(0, 'Quantity cannot be negative')
    .max(1_000_000_000)
    .optional(),
});

export const productUpdateSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(64).optional(),
  name: z.string().trim().min(1, 'Name is required').max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  categoryId: z.string().min(1, 'Category is required').max(128).optional(),
  brandId: z.string().min(1).max(128).optional().nullable(),
  costPrice: z.coerce
    .number()
    .min(0, 'Cost price cannot be negative')
    .max(1_000_000_000)
    .optional(),
  retailPrice: z.coerce
    .number()
    .min(0, 'Retail price cannot be negative')
    .max(1_000_000_000)
    .optional(),
  wholesalePrice: z.coerce
    .number()
    .min(0, 'Wholesale price cannot be negative')
    .max(1_000_000_000)
    .optional(),
  minimumStock: z.coerce.number().int().min(0).max(1_000_000).optional(),
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000).optional(),
  status: statusSchema.optional(),
});

export const productListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: z.string().min(1).max(128).optional(),
  brandId: z.string().min(1).max(128).optional(),
  status: statusSchema.optional(),
  ...sortSchema(
    ['name', 'sku', 'costPrice', 'retailPrice', 'wholesalePrice', 'createdAt', 'updatedAt'],
    'name',
  ),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});