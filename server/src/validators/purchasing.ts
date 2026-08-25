import {
  PaymentMethod,
  PurchaseOrderStatus,
  PurchaseReturnStatus,
  PurchaseStatus,
  PurchasePaymentStatus,
} from '@prisma/client';
import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  sortSchema,
} from './catalog.js';

const page = z.coerce.number().int().positive();
const pageSize = z.coerce.number().int().positive().max(MAX_PAGE_SIZE);

const money = z.coerce
  .number()
  .min(0, 'Amount cannot be negative')
  .max(1_000_000_000, 'Amount is too large');

const quantity = z.coerce
  .number({ invalid_type_error: 'Quantity must be a number' })
  .int('Quantity must be an integer')
  .min(0, 'Quantity cannot be negative');

const positiveQuantity = z.coerce
  .number({ invalid_type_error: 'Quantity must be a number' })
  .int('Quantity must be an integer')
  .min(1, 'Quantity must be at least 1');

const optionalText = z.string().trim().max(500).optional().nullable();

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, 'Supplier name is required').max(120),
  contactPerson: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email('Invalid email').max(160).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  notes: optionalText,
});

export const supplierUpdateSchema = supplierCreateSchema.partial();

export const supplierStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

export const supplierListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  ...sortSchema(['name', 'createdAt', 'updatedAt'], 'name'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const supplierProductLinkSchema = z.object({
  productId: z.string().min(1).max(128),
  supplierPartNumber: z.string().trim().max(128).optional().nullable(),
  unitCost: money.optional().nullable(),
  notes: optionalText,
  isPreferred: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const supplierProductUpdateSchema = supplierProductLinkSchema
  .omit({ productId: true })
  .partial();

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const purchaseOrderItemInput = z.object({
  productId: z.string().min(1).max(128),
  quantityOrdered: positiveQuantity,
  unitCost: money,
  notes: z.string().trim().max(300).optional().nullable(),
});

export const purchaseOrderCreateSchema = z.object({
  supplierId: z.string().min(1).max(128),
  orderDate: z.string().datetime({ message: 'orderDate must be an ISO-8601 date' }).optional(),
  expectedDelivery: z
    .string()
    .datetime({ message: 'expectedDelivery must be an ISO-8601 date' })
    .optional()
    .nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(purchaseOrderItemInput).min(1, 'A purchase order needs at least one item').max(500),
});

export const purchaseOrderUpdateSchema = z
  .object({
    orderDate: z.string().datetime({ message: 'orderDate must be an ISO-8601 date' }).optional(),
    expectedDelivery: z
      .string()
      .datetime({ message: 'expectedDelivery must be an ISO-8601 date' })
      .optional()
      .nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    items: z.array(purchaseOrderItemInput).min(1, 'A purchase order needs at least one item').max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const purchaseOrderListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  supplierId: z.string().min(1).max(128).optional(),
  status: z.nativeEnum(PurchaseOrderStatus).optional(),
  from: z.string().datetime({ message: 'from must be an ISO-8601 date' }).optional(),
  to: z.string().datetime({ message: 'to must be an ISO-8601 date' }).optional(),
  ...sortSchema(['orderNumber', 'orderDate', 'totalAmount', 'status', 'createdAt'], 'orderDate'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Purchases / receiving
// ---------------------------------------------------------------------------

// One receiving line. For PO-linked receiving the unit cost and ordered
// quantity are taken from the PO line; for direct purchases they are required.
export const receiveItemInput = z.object({
  purchaseOrderItemId: z.string().min(1).max(128).optional(),
  productId: z.string().min(1).max(128),
  quantityReceived: quantity.refine((v) => v > 0, 'Received quantity must be at least 1'),
  quantityDamaged: quantity.optional().default(0),
  quantityMissing: quantity.optional().default(0),
  unitCost: money.optional(),
  quantityOrdered: positiveQuantity.optional(),
});

export const purchaseCreateSchema = z.object({
  purchaseOrderId: z.string().min(1).max(128).optional(),
  supplierId: z.string().min(1).max(128).optional(),
  invoiceReference: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  receivedAt: z.string().datetime({ message: 'receivedAt must be an ISO-8601 date' }).optional(),
  items: z.array(receiveItemInput).min(1, 'Receiving needs at least one line').max(500),
}).refine(
  (v) => Boolean(v.purchaseOrderId) || Boolean(v.supplierId),
  'A purchase must reference a purchase order or a supplier',
);

export const purchaseListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  supplierId: z.string().min(1).max(128).optional(),
  purchaseOrderId: z.string().min(1).max(128).optional(),
  status: z.nativeEnum(PurchaseStatus).optional(),
  paymentStatus: z.nativeEnum(PurchasePaymentStatus).optional(),
  from: z.string().datetime({ message: 'from must be an ISO-8601 date' }).optional(),
  to: z.string().datetime({ message: 'to must be an ISO-8601 date' }).optional(),
  ...sortSchema(['purchaseNumber', 'receivedAt', 'totalAmount', 'status', 'paymentStatus', 'createdAt'], 'receivedAt'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

// ---------------------------------------------------------------------------
// Supplier credit
// ---------------------------------------------------------------------------

export const creditPaymentCreateSchema = z.object({
  purchaseId: z.string().min(1).max(128).optional().nullable(),
  amount: money.refine((v) => v > 0, 'Payment amount must be greater than zero'),
  paymentMethod: z.nativeEnum(PaymentMethod),
  reference: z.string().trim().max(120).optional().nullable(),
  paidAt: z.string().datetime({ message: 'paidAt must be an ISO-8601 date' }).optional(),
});

export const creditPaymentsListQuery = z.object({
  from: z.string().datetime({ message: 'from must be an ISO-8601 date' }).optional(),
  to: z.string().datetime({ message: 'to must be an ISO-8601 date' }).optional(),
  ...sortSchema(['paidAt', 'amount', 'createdAt'], 'paidAt'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});

export const idParamSchema = z.object({
  id: z.string().min(1).max(128),
});

export const productIdParamSchema = z.object({
  productId: z.string().min(1).max(128),
});
// ---------------------------------------------------------------------------
// Purchase returns (Stage 8)
// ---------------------------------------------------------------------------

export const purchaseReturnItemInput = z.object({
  purchaseItemId: z.string().min(1).max(128),
  quantity: positiveQuantity,
});

export const purchaseReturnCreateSchema = z
  .object({
    items: z.array(purchaseReturnItemInput).min(1, 'At least one return line is required').max(100),
    reason: z.string().trim().min(3, 'A reason is required for purchase returns').max(500),
    settlement: z.enum(['SUPPLIER_CREDIT', 'REFUND', 'NONE']).default('NONE'),
    refundMethod: z.nativeEnum(PaymentMethod).optional(),
    refundReference: z.string().trim().max(120).optional().nullable(),
  })
  .refine(
    (v) => v.settlement !== 'REFUND' || v.refundMethod !== undefined,
    { message: 'refundMethod is required when settling by refund', path: ['refundMethod'] },
  )
  .refine(
    (v) => v.settlement !== 'SUPPLIER_CREDIT' || !(v.refundMethod || v.refundReference),
    { message: 'Refund details must not be set when settling by supplier credit', path: ['refundMethod'] },
  );

export const purchaseReturnListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  purchaseId: z.string().min(1).max(128).optional(),
  supplierId: z.string().min(1).max(128).optional(),
  status: z.nativeEnum(PurchaseReturnStatus).optional(),
  ...sortSchema(['returnDate', 'totalAmount', 'createdAt'], 'returnDate'),
  page: page.default(1),
  pageSize: pageSize.default(DEFAULT_PAGE_SIZE),
});
