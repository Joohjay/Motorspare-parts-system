import { IdentifierType } from '@prisma/client';
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
// Named catalog entities (categories, brands, makes, models, variants)
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

export const makeCreateSchema = z.object({
  name: nameField,
});

export const makeUpdateSchema = z.object({
  name: nameField.optional(),
});

export const modelCreateSchema = z.object({
  makeId: z.string().min(1).max(128),
  name: nameField,
});

export const modelUpdateSchema = z.object({
  name: nameField.optional(),
});

export const variantCreateSchema = z.object({
  modelId: z.string().min(1).max(128),
  name: nameField,
  yearFrom: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
});

export const variantUpdateSchema = z.object({
  name: nameField.optional(),
  yearFrom: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
  yearTo: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
});

export const modelListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: statusSchema.optional(),
  makeId: z.string().min(1).max(128).optional(),
  ...sortSchema(['name', 'createdAt', 'updatedAt'], 'name'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const variantListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: statusSchema.optional(),
  makeId: z.string().min(1).max(128).optional(),
  modelId: z.string().min(1).max(128).optional(),
  // Free-text compatibility search across the make/model/variant names.
  make: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  variant: z.string().trim().max(120).optional(),
  ...sortSchema(['name', 'yearFrom', 'yearTo', 'createdAt', 'updatedAt'], 'name'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const identifierSchema = z.object({
  type: z.enum([
    IdentifierType.PART_NUMBER,
    IdentifierType.OEM_NUMBER,
    IdentifierType.ALTERNATIVE_NUMBER,
    IdentifierType.SUPPLIER_NUMBER,
    IdentifierType.OTHER,
  ]),
  value: z.string().trim().min(1, 'Identifier value is required').max(128),
});

export const compatibilityEntrySchema = z.object({
  variantId: z.string().min(1).max(128),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const productBaseFields = {
  sku: z.string().trim().min(1, 'SKU is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  categoryId: z.string().min(1, 'Category is required').max(128),
  brandId: z.string().min(1).max(128).optional().nullable(),
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
  identifiers: z.array(identifierSchema).max(50).optional(),
  compatibility: z.array(compatibilityEntrySchema).max(500).optional(),
});

export const productUpdateSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(64).optional(),
  name: z.string().trim().min(1, 'Name is required').max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  categoryId: z.string().min(1, 'Category is required').max(128).optional(),
  brandId: z.string().min(1).max(128).optional().nullable(),
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
  // When provided, the identifier set is replaced wholesale (audited per
  // change). When omitted, existing identifiers are left untouched.
  identifiers: z.array(identifierSchema).max(50).optional(),
  // Same semantics as identifiers: full replace when provided.
  compatibility: z.array(compatibilityEntrySchema).max(500).optional(),
});

export const productListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: z.string().min(1).max(128).optional(),
  brandId: z.string().min(1).max(128).optional(),
  status: statusSchema.optional(),
  // Compatibility filters: find products compatible with a make/model/variant.
  makeId: z.string().min(1).max(128).optional(),
  modelId: z.string().min(1).max(128).optional(),
  variantId: z.string().min(1).max(128).optional(),
  ...sortSchema(
    ['name', 'sku', 'retailPrice', 'wholesalePrice', 'createdAt', 'updatedAt'],
    'name',
  ),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Compatibility (standalone add/remove)
// ---------------------------------------------------------------------------

export const compatibilityAddSchema = z.object({
  productId: z.string().min(1).max(128),
  variantId: z.string().min(1).max(128),
  notes: z.string().trim().max(500).optional().nullable(),
});