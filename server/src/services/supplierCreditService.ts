import { CreditAccountStatus, PaymentMethod, Prisma } from '@prisma/client';
import type { Request } from 'express';

import { AUDIT } from '../constants/auditActions.js';
import prisma from '../lib/prisma.js';
import { ApiError } from '../middleware/error.js';
import { recordAudit } from '../utils/audit.js';
import { paginate } from '../utils/pagination.js';

type PurchaseWithPayments = Prisma.PurchaseGetPayload<{
  include: { creditPayments: { select: { amount: true } } };
}>;

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

async function ensureSupplier(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    throw new ApiError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found');
  }
  return supplier;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export async function openCreditAccount(supplierId: string, context: Context) {
  await ensureSupplier(supplierId);
  const existing = await prisma.supplierCreditAccount.findUnique({
    where: { supplierId },
  });
  if (existing) {
    throw new ApiError(409, 'SUPPLIER_CREDIT_EXISTS', 'Supplier already has a credit account');
  }
  const account = await prisma.supplierCreditAccount.create({
    data: { supplierId, outstandingBalance: new Prisma.Decimal(0), status: CreditAccountStatus.ACTIVE },
  });
  audit({
    action: AUDIT.SUPPLIER_CREDIT_ACCOUNT_OPENED,
    entityType: 'SupplierCreditAccount',
    entityId: account.id,
    afterState: { supplierId, status: account.status },
    context,
  });
  return account;
}

export async function getCreditAccount(supplierId: string) {
  const account = await prisma.supplierCreditAccount.findUnique({
    where: { supplierId },
    include: {
      payments: {
        orderBy: { paidAt: 'desc' },
        take: 5,
        include: {
          purchase: { select: { id: true, purchaseNumber: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      },
      _count: { select: { payments: true, purchases: true } },
    },
  });
  if (!account) {
    throw new ApiError(404, 'SUPPLIER_CREDIT_NOT_FOUND', 'Supplier has no credit account');
  }
  return account;
}

export async function listCreditPayments(
  supplierId: string,
  query: { from?: string; to?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; page?: number; pageSize?: number },
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const where = {
    account: { supplierId },
    ...(query.from ? { paidAt: { gte: new Date(query.from) } } : {}),
    ...(query.to ? { paidAt: { lte: new Date(query.to) } } : {}),
  };

  const [totalItems, items] = await Promise.all([
    prisma.supplierCreditPayment.count({ where }),
    prisma.supplierCreditPayment.findMany({
      where,
      orderBy: [{ [query.sortBy ?? 'paidAt']: query.sortOrder ?? 'desc' }],
      include: {
        purchase: { select: { id: true, purchaseNumber: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(items, page, pageSize, totalItems);
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Records a payment against a supplier's credit account.
 *
 * Concurrency-safe: the account row is locked FOR UPDATE inside the
 * transaction, so two concurrent payments serialize and can never drive the
 * outstanding balance below zero. Payments that exceed the outstanding balance
 * are rejected. When a purchase is referenced, the payment cannot exceed that
 * purchase's own remaining amount either.
 */
export async function recordCreditPayment(
  supplierId: string,
  body: {
    purchaseId?: string | null;
    amount: number;
    paymentMethod: PaymentMethod;
    reference?: string | null;
    paidAt?: string;
  },
  context: Context,
) {
  await ensureSupplier(supplierId);
  const amount = new Prisma.Decimal(body.amount);

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; outstandingBalance: Prisma.Decimal | string }>
    >(
      Prisma.sql`
        SELECT "id", "outstandingBalance"
        FROM "supplier_credit_accounts"
        WHERE "supplierId" = ${supplierId}
        FOR UPDATE
      `,
    );
    const accountRow = rows[0];
    if (!accountRow) {
      throw new ApiError(404, 'SUPPLIER_CREDIT_NOT_FOUND', 'Supplier has no credit account');
    }
    const account = await tx.supplierCreditAccount.findUnique({
      where: { id: accountRow.id },
    });
    if (!account) {
      throw new ApiError(404, 'SUPPLIER_CREDIT_NOT_FOUND', 'Supplier has no credit account');
    }
    if (account.status !== CreditAccountStatus.ACTIVE) {
      throw new ApiError(409, 'SUPPLIER_CREDIT_NOT_ACTIVE', 'Supplier credit account is not active');
    }

    const balance = new Prisma.Decimal(account.outstandingBalance);
    if (amount.greaterThan(balance)) {
      throw new ApiError(
        409,
        'SUPPLIER_PAYMENT_EXCEEDS_BALANCE',
        `Payment of ${amount.toString()} exceeds the outstanding balance of ${balance.toString()}`,
      );
    }

    let purchase: PurchaseWithPayments | null = null;
    let purchaseRemaining = balance;

    if (body.purchaseId) {
      purchase = await tx.purchase.findUnique({
        where: { id: body.purchaseId },
        include: { creditPayments: { select: { amount: true } } },
      });
      if (!purchase) {
        throw new ApiError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
      }
      if (purchase.supplierId !== supplierId) {
        throw new ApiError(409, 'PURCHASE_NOT_FOUND', 'Purchase does not belong to this supplier');
      }
      const paidSoFar = purchase.creditPayments.reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0));
      purchaseRemaining = new Prisma.Decimal(purchase.totalAmount).sub(paidSoFar);
      if (amount.greaterThan(purchaseRemaining)) {
        throw new ApiError(
          409,
          'SUPPLIER_PAYMENT_EXCEEDS_BALANCE',
          `Payment of ${amount.toString()} exceeds the purchase's remaining amount of ${purchaseRemaining.toString()}`,
        );
      }
    }

    const payment = await tx.supplierCreditPayment.create({
      data: {
        accountId: account.id,
        purchaseId: body.purchaseId ?? null,
        paymentMethod: body.paymentMethod,
        amount,
        reference: body.reference ?? null,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        createdById: context.actor!.id,
      },
    });

    await tx.supplierCreditAccount.update({
      where: { id: account.id },
      data: { outstandingBalance: balance.sub(amount) },
    });

    if (purchase) {
      const newPaid = purchase.creditPayments.reduce((sum, p) => sum.add(p.amount), new Prisma.Decimal(0)).add(amount);
      const paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID' =
        newPaid.greaterThanOrEqualTo(new Prisma.Decimal(purchase.totalAmount))
          ? 'PAID'
          : newPaid.greaterThan(0)
            ? 'PARTIAL'
            : 'UNPAID';
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { paymentStatus: paymentStatus as never },
      });
    }

    return { payment, newBalance: balance.sub(amount) };
  });

  const creditAccount = await prisma.supplierCreditAccount.findUniqueOrThrow({
    where: { supplierId },
  });

  audit({
    action: AUDIT.SUPPLIER_CREDIT_PAYMENT_RECORDED,
    entityType: 'SupplierCreditPayment',
    entityId: result.payment.id,
    afterState: {
      supplierId,
      amount: Number(amount),
      purchaseId: body.purchaseId ?? null,
      outstandingBalanceAfter: Number(result.newBalance),
    },
    context,
  });

  return { payment: result.payment, creditAccount };
}