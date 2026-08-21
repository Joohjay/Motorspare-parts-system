import { CustomerStatus, CustomerType, PaymentMethod, ReturnCondition, SaleStatus, SaleType } from '@prisma/client';
import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  sortSchema,
} from './catalog.js';

const page = z.coerce.number().int().positive();
const pageSize = z.coerce.number().int().positive().max(MAX_PAGE_SIZE);

// Money arrives as a JSON number (existing project convention — see
// purchasing.ts). Services convert to Prisma.Decimal via String() so no
// floating-point arithmetic is ever performed on authoritative values.
const money = z.coerce
  .number()
  .min(0, 'Amount cannot be negative')
  .max(1_000_000_000, 'Amount is too large');

const positiveMoney = z.coerce
  .number({ invalid_type_error: 'Amount must be a number' })
  .positive('Amount must be greater than zero')
  .max(1_000_000_000, 'Amount is too large');

const positiveQuantity = z.coerce
  .number({ invalid_type_error: 'Quantity must be a number' })
  .int('Quantity must be an integer')
  .min(1, 'Quantity must be at least 1');

const optionalText = z.string().trim().max(500).optional().nullable();
const idString = z.string().trim().min(1).max(64);

const isoDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email('Invalid email').max(160).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: optionalText,
  type: z.nativeEnum(CustomerType).default(CustomerType.RETAIL),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const customerStatusSchema = z.object({
  status: z.nativeEnum(CustomerStatus),
});

export const customerListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.nativeEnum(CustomerStatus).optional(),
  type: z.nativeEnum(CustomerType).optional(),
  ...sortSchema(['name', 'phone', 'type', 'status', 'createdAt', 'updatedAt'], 'name'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Customer credit
// ---------------------------------------------------------------------------

export const creditLimitSchema = z.object({
  creditLimit: money,
});

export const customerCreditPaymentCreateSchema = z.object({
  amount: positiveMoney,
  paymentMethod: z.nativeEnum(PaymentMethod),
  reference: z.string().trim().max(120).optional().nullable(),
  paidAt: isoDate.optional(),
});

export const creditPaymentsListQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...sortSchema(['paidAt', 'amount'], 'paidAt'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const statementQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

// ---------------------------------------------------------------------------
// Sales / POS
// ---------------------------------------------------------------------------

const saleItemInput = z
  .object({
    productId: idString,
    quantity: positiveQuantity,
    // Omitted => the server applies the product's default price for the sale
    // type. Present => ADMIN-only price override (audited).
    unitPrice: money.optional(),
    discount: money.optional().default(0),
  })
  .strict();

const paymentAllocationInput = z
  .object({
    paymentMethod: z.nativeEnum(PaymentMethod),
    amount: positiveMoney,
    reference: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export const saleCreateSchema = z
  .object({
    items: z.array(saleItemInput).min(1, 'A sale needs at least one item').max(100),
    customerId: idString.optional().nullable(),
    saleType: z.nativeEnum(SaleType).default(SaleType.RETAIL),
    // Sale-level discount applied after line totals.
    discount: money.optional().default(0),
    notes: optionalText,
    payments: z.array(paymentAllocationInput).max(10).default([]),
  })
  .strict();

export const saleVoidSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required to void a sale').max(500),
});

export const saleListQuery = z.object({
  q: z.string().trim().max(64).optional(), // sale number search
  customerId: idString.optional(),
  status: z.nativeEnum(SaleStatus).optional(),
  saleType: z.nativeEnum(SaleType).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  createdById: idString.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...sortSchema(['saleNumber', 'totalAmount', 'createdAt'], 'createdAt'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Sales returns
// ---------------------------------------------------------------------------

export const saleReturnCreateSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            saleItemId: idString,
            quantity: positiveQuantity,
            condition: z.nativeEnum(ReturnCondition).default(ReturnCondition.GOOD),
          })
          .strict(),
      )
      .min(1, 'A return needs at least one item')
      .max(100),
    reason: z.string().trim().min(3, 'A return reason is required').max(500),
    // Exactly one settlement path must be chosen:
    //  - creditAdjusted: reduce the customer's outstanding balance
    //  - refundMethod: money back via the given channel
    creditAdjusted: z.boolean().optional().default(false),
    refundMethod: z.nativeEnum(PaymentMethod).optional(),
    refundReference: z.string().trim().max(120).optional().nullable(),
  })
  .strict()
  .refine((data) => data.creditAdjusted !== (data.refundMethod !== undefined), {
    message: 'Choose exactly one refund method: credit adjustment or a refund payment method',
    path: ['refundMethod'],
  });

export const saleReturnListQuery = z.object({
  q: z.string().trim().max(64).optional(), // return number search
  saleId: idString.optional(),
  customerId: idString.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...sortSchema(['returnNumber', 'totalAmount', 'returnDate'], 'returnDate'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const expenseCategoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(80),
  description: optionalText,
});

export const expenseCategoryUpdateSchema = expenseCategoryCreateSchema.partial();

export const expenseCreateSchema = z.object({
  categoryId: idString,
  amount: positiveMoney,
  expenseDate: isoDate.optional(),
  description: optionalText,
  reference: z.string().trim().max(120).optional().nullable(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional().nullable(),
});

export const expenseUpdateSchema = expenseCreateSchema.partial();

export const expenseListQuery = z.object({
  categoryId: idString.optional(),
  status: z.enum(['ACTIVE', 'VOIDED']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...sortSchema(['expenseDate', 'amount', 'createdAt'], 'expenseDate'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportRangeQuery = z
  .object({
    preset: z.enum(['today', 'yesterday', 'this_week', 'this_month']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((data) => data.preset !== undefined || (data.from !== undefined && data.to !== undefined), {
    message: 'Provide a preset or both from and to dates',
  });
