import { CreditAccountStatus, PaymentMethod, Prisma } from '@prisma/client';
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

/**
 * Locks the customer's credit account row FOR UPDATE and returns it. The
 * account must already exist — credit accounts are opened explicitly by an
 * ADMIN before any credit can be extended. Serializes concurrent credit
 * mutations (sale credit charges, payments, refunds) on the same account.
 * Never call outside a transaction.
 */
export async function lockCreditAccount(tx: Tx, customerId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "customer_credit_accounts"
      WHERE "customerId" = ${customerId}
      FOR UPDATE
    `,
  );
  if (!rows[0]) {
    throw new ApiError(404, 'CUSTOMER_CREDIT_NOT_FOUND', 'Customer has no credit account');
  }
  const account = await tx.customerCreditAccount.findUniqueOrThrow({
    where: { id: rows[0].id },
  });
  return account;
}

/**
 * Charges a credit sale portion to the customer's account. Enforces the
 * credit limit server-side (availableCredit = limit - outstanding). Must be
 * called inside the sale's transaction so the charge commits or rolls back
 * with the sale. Returns the updated balance.
 */
export async function chargeCreditTx(
  tx: Tx,
  input: { customerId: string; amount: Prisma.Decimal; saleNumber: string },
): Promise<Prisma.Decimal> {
  const account = await lockCreditAccount(tx, input.customerId);
  if (account.status !== CreditAccountStatus.ACTIVE) {
    throw new ApiError(409, 'CUSTOMER_CREDIT_NOT_ACTIVE', 'Customer credit account is not active');
  }

  const balance = new Prisma.Decimal(account.outstandingBalance);
  const limit = new Prisma.Decimal(account.creditLimit);
  const available = limit.sub(balance);
  if (input.amount.greaterThan(available)) {
    throw new ApiError(
      409,
      'CREDIT_LIMIT_EXCEEDED',
      `Credit charge of ${input.amount.toFixed(2)} exceeds the customer's available credit of ${available.toFixed(2)} (limit ${limit.toFixed(2)}, outstanding ${balance.toFixed(2)})`,
    );
  }

  const newBalance = balance.add(input.amount);
  await tx.customerCreditAccount.update({
    where: { id: account.id },
    data: { outstandingBalance: newBalance },
  });
  return newBalance;
}

// ---------------------------------------------------------------------------
// Account management
// ---------------------------------------------------------------------------

export async function openCreditAccount(customerId: string, context: Context) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw ApiError.notFound('Customer not found');

  const existing = await prisma.customerCreditAccount.findUnique({ where: { customerId } });
  if (existing) {
    throw new ApiError(409, 'CUSTOMER_CREDIT_EXISTS', 'Customer already has a credit account');
  }
  const account = await prisma.customerCreditAccount.create({
    data: { customerId, creditLimit: new Prisma.Decimal(0), outstandingBalance: new Prisma.Decimal(0), status: CreditAccountStatus.ACTIVE },
  });
  audit({
    action: AUDIT.CUSTOMER_CREDIT_ACCOUNT_OPENED,
    entityType: 'CustomerCreditAccount',
    entityId: account.id,
    afterState: { customerId, status: account.status },
    context,
  });
  return account;
}

export async function getCreditAccount(customerId: string) {
  const account = await prisma.customerCreditAccount.findUnique({
    where: { customerId },
    include: {
      customer: { select: { id: true, name: true, phone: true, status: true } },
      payments: {
        orderBy: { paidAt: 'desc' },
        take: 5,
        include: { createdBy: { select: { id: true, fullName: true } } },
      },
      _count: { select: { payments: true } },
    },
  });
  if (!account) {
    throw new ApiError(404, 'CUSTOMER_CREDIT_NOT_FOUND', 'Customer has no credit account');
  }
  const outstanding = new Prisma.Decimal(account.outstandingBalance);
  const limit = new Prisma.Decimal(account.creditLimit);
  return {
    ...account,
    outstandingBalance: outstanding.toFixed(2),
    creditLimit: limit.toFixed(2),
    availableCredit: limit.sub(outstanding).toFixed(2),
  };
}

/** ADMIN-only. Credit-limit changes are audited with before/after values. */
export async function setCreditLimit(
  customerId: string,
  creditLimit: number,
  context: Context,
) {
  const amount = new Prisma.Decimal(String(creditLimit));
  const result = await prisma.$transaction(async (tx) => {
    const account = await lockCreditAccount(tx, customerId);
    const previous = new Prisma.Decimal(account.creditLimit);
    // A lower limit is fine as long as the current balance still fits under
    // it — otherwise the account would be in violation of its own policy.
    if (new Prisma.Decimal(account.outstandingBalance).greaterThan(amount)) {
      throw new ApiError(
        409,
        'CREDIT_LIMIT_BELOW_BALANCE',
        'New credit limit is below the current outstanding balance',
      );
    }
    const updated = await tx.customerCreditAccount.update({
      where: { id: account.id },
      data: { creditLimit: amount },
    });
    return { updated, previous };
  });

  audit({
    action: AUDIT.CUSTOMER_CREDIT_LIMIT_CHANGED,
    entityType: 'CustomerCreditAccount',
    entityId: result.updated.id,
    beforeState: { creditLimit: Number(result.previous) },
    afterState: { creditLimit: Number(result.updated.creditLimit) },
    context,
  });
  return result.updated;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Records a payment against the customer's outstanding balance.
 *
 * Concurrency-safe: the account row is locked FOR UPDATE inside the
 * transaction, so two concurrent payments serialize and can never drive the
 * balance below zero. Overpayments are rejected.
 */
export async function recordCreditPayment(
  customerId: string,
  body: {
    amount: number;
    paymentMethod: PaymentMethod;
    reference?: string | null;
    paidAt?: string;
  },
  context: Context,
) {
  const amount = new Prisma.Decimal(String(body.amount));

  const result = await prisma.$transaction(async (tx) => {
    const account = await lockCreditAccount(tx, customerId);
    if (account.status !== CreditAccountStatus.ACTIVE) {
      throw new ApiError(409, 'CUSTOMER_CREDIT_NOT_ACTIVE', 'Customer credit account is not active');
    }

    const balance = new Prisma.Decimal(account.outstandingBalance);
    if (amount.greaterThan(balance)) {
      throw new ApiError(
        409,
        'PAYMENT_EXCEEDS_BALANCE',
        `Payment of ${amount.toFixed(2)} exceeds the outstanding balance of ${balance.toFixed(2)}`,
      );
    }

    const payment = await tx.customerCreditPayment.create({
      data: {
        accountId: account.id,
        paymentMethod: body.paymentMethod,
        amount,
        reference: body.reference ?? null,
        paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        createdById: context.actor!.id,
      },
    });

    const newBalance = balance.sub(amount);
    await tx.customerCreditAccount.update({
      where: { id: account.id },
      data: { outstandingBalance: newBalance },
    });

    return { payment, newBalance };
  });

  audit({
    action: AUDIT.CUSTOMER_CREDIT_PAYMENT_CREATED,
    entityType: 'CustomerCreditPayment',
    entityId: result.payment.id,
    afterState: {
      customerId,
      amount: Number(amount),
      method: body.paymentMethod,
      outstandingBalanceAfter: Number(result.newBalance),
    },
    context,
  });

  return { payment: result.payment, newBalance: result.newBalance };
}

export async function listCreditPayments(
  customerId: string,
  query: { from?: string; to?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; page?: number; pageSize?: number },
) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const where = {
    account: { customerId },
    ...(query.from || query.to
      ? {
          paidAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [totalItems, items] = await Promise.all([
    prisma.customerCreditPayment.count({ where }),
    prisma.customerCreditPayment.findMany({
      where,
      orderBy: [{ [query.sortBy ?? 'paidAt']: query.sortOrder ?? 'desc' }],
      include: { createdBy: { select: { id: true, fullName: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return paginate(items, page, pageSize, totalItems);
}

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

export interface StatementRow {
  date: Date;
  type: 'SALE_CREDIT' | 'PAYMENT';
  reference: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

/**
 * Authoritative customer credit statement. Debits are the CREDIT portions of
 * completed sales; credits are payments received. The running balance is
 * computed server-side from source transactions — the frontend never invents
 * balances.
 */
export async function getStatement(customerId: string, query: { from?: string; to?: string }) {
  const account = await prisma.customerCreditAccount.findUnique({ where: { customerId } });
  if (!account) {
    throw new ApiError(404, 'CUSTOMER_CREDIT_NOT_FOUND', 'Customer has no credit account');
  }

  const rangeFilter = query.from || query.to
    ? {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      }
    : undefined;

  const [creditSales, payments] = await Promise.all([
    prisma.payment.findMany({
      where: {
        paymentMethod: PaymentMethod.CREDIT,
        sale: { customerId, status: 'COMPLETED' },
        ...(rangeFilter ? { createdAt: rangeFilter } : {}),
      },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        sale: { select: { saleNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.customerCreditPayment.findMany({
      where: { account: { customerId }, ...(rangeFilter ? { paidAt: rangeFilter } : {}) },
      select: { id: true, amount: true, paidAt: true, reference: true, paymentMethod: true },
      orderBy: { paidAt: 'asc' },
    }),
  ]);

  interface Entry {
    date: Date;
    seq: number;
    row: Omit<StatementRow, 'balance'>;
  }
  const entries: Entry[] = [
    ...creditSales.map((p, index) => ({
      date: p.createdAt,
      seq: index,
      row: {
        date: p.createdAt,
        type: 'SALE_CREDIT' as const,
        reference: p.sale.saleNumber,
        description: 'Credit sale',
        debit: new Prisma.Decimal(p.amount).toFixed(2),
        credit: new Prisma.Decimal(0).toFixed(2),
      },
    })),
    ...payments.map((p, index) => ({
      date: p.paidAt,
      seq: creditSales.length + index,
      row: {
        date: p.paidAt,
        type: 'PAYMENT' as const,
        reference: p.reference ?? p.id,
        description: `Payment (${p.paymentMethod})`,
        debit: new Prisma.Decimal(0).toFixed(2),
        credit: new Prisma.Decimal(p.amount).toFixed(2),
      },
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.seq - b.seq);

  let running = new Prisma.Decimal(0);
  const rows: StatementRow[] = entries.map((entry) => {
    running = running.add(entry.row.debit).sub(entry.row.credit);
    return { ...entry.row, balance: running.toFixed(2) };
  });

  return {
    account: {
      id: account.id,
      creditLimit: new Prisma.Decimal(account.creditLimit).toFixed(2),
      outstandingBalance: new Prisma.Decimal(account.outstandingBalance).toFixed(2),
      status: account.status,
    },
    rows,
  };
}
