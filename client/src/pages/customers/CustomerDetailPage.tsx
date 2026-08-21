import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import {
  EmptyState,
  ErrorState,
  Field,
  FormError,
  LoadingState,
  SelectInput,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import {
  customerStatusLabels,
  customerTypeLabels,
  customerCreditApi,
  customersApi,
} from '@/lib/customersApi';
import { formatCurrency } from '@/lib/inventoryApi';
import type {
  CustomerCreditAccount,
  CustomerCreditPayment,
  CustomerDetail,
  CustomerStatement,
} from '@/types/api';

const PAYMENT_METHODS = ['CASH', 'MPESA', 'BANK', 'CHEQUE', 'OTHER'] as const;

export function CustomerDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creditAccount, setCreditAccount] = useState<CustomerCreditAccount | null>(null);
  const [payments, setPayments] = useState<CustomerCreditPayment[]>([]);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);

  const [limitInput, setLimitInput] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { customer: loaded } = await customersApi.get(id);
      setCustomer(loaded);
      if (loaded.creditAccount) {
        setCreditAccount({
          id: loaded.creditAccount.id,
          customerId: loaded.id,
          creditLimit: loaded.creditAccount.creditLimit,
          outstandingBalance: loaded.creditAccount.outstandingBalance,
          status: loaded.creditAccount.status,
          openedAt: loaded.creditAccount.createdAt,
          createdAt: loaded.creditAccount.createdAt,
          updatedAt: loaded.creditAccount.createdAt,
        });
        setLimitInput(loaded.creditAccount.creditLimit);
        const [paymentPage, statementData] = await Promise.all([
          customerCreditApi.payments(id),
          customerCreditApi.statement(id),
        ]);
        setPayments(paymentPage.items);
        setStatement(statementData);
      }
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load the customer'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAccount = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await customerCreditApi.openAccount(id);
      await load();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not open the credit account'));
    } finally {
      setBusy(false);
    }
  };

  const saveLimit = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await customerCreditApi.setLimit(id, Number(limitInput));
      await load();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not update the credit limit'));
    } finally {
      setBusy(false);
    }
  };

  const recordPayment = async (): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await customerCreditApi.recordPayment(id, {
        amount: Number(paymentAmount),
        paymentMethod,
        reference: paymentReference.trim() || null,
      });
      setPaymentAmount('');
      setPaymentReference('');
      await load();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not record the payment'));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="p-6">
        <ErrorState message={loadError} />
      </div>
    );
  }
  if (!customer) {
    return (
      <div className="p-6">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/customers" className="text-sm text-brand-700 hover:underline">
            ← Customers
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{customer.name}</h1>
          <p className="text-sm text-slate-500">
            {customerTypeLabels[customer.type]} · {customer.phone ?? 'no phone'} ·{' '}
            {customer.salesCount} sale(s)
          </p>
        </div>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            customer.status === 'ACTIVE'
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-slate-100 text-slate-600 ring-slate-200'
          }`}
        >
          {customerStatusLabels[customer.status]}
        </span>
      </div>

      <FormError message={actionError} />

      {/* Credit account */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Credit account</h2>
        {!creditAccount ? (
          <div className="mt-3 space-y-3">
            <EmptyState message="No credit account for this customer." />
            {isAdmin && (
              <Button onClick={() => void openAccount()} disabled={busy}>
                Open credit account
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Outstanding</p>
                <p className="text-lg font-semibold text-slate-900">
                  {formatCurrency(creditAccount.outstandingBalance)}
                </p>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Credit limit</p>
                <p className="text-lg font-semibold text-slate-900">
                  {formatCurrency(creditAccount.creditLimit)}
                </p>
              </div>
              <div className="rounded-md bg-slate-50 p-3">
                <p className="text-xs uppercase text-slate-400">Available</p>
                <p className="text-lg font-semibold text-slate-900">
                  {formatCurrency(
                    (
                      Number(creditAccount.creditLimit) - Number(creditAccount.outstandingBalance)
                    ).toFixed(2),
                  )}
                </p>
              </div>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Set credit limit" htmlFor="credit-limit">
                  <TextInput
                    id="credit-limit"
                    type="number"
                    min={0}
                    step="0.01"
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                  />
                </Field>
                <Button variant="secondary" onClick={() => void saveLimit()} disabled={busy}>
                  Save limit
                </Button>
              </div>
            )}

            {isAdmin && (
              <form
                className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void recordPayment();
                }}
              >
                <Field label="Record payment" htmlFor="cc-amount">
                  <TextInput
                    id="cc-amount"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                  />
                </Field>
                <Field label="Method" htmlFor="cc-method">
                  <SelectInput
                    id="cc-method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Reference" htmlFor="cc-reference">
                  <TextInput
                    id="cc-reference"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={busy || !paymentAmount}>
                  Record
                </Button>
              </form>
            )}
          </div>
        )}
      </section>

      {/* Statement */}
      {statement && statement.rows.length > 0 && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Statement</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Ref</th>
                <th className="px-4 py-2 text-right">Debit</th>
                <th className="px-4 py-2 text-right">Credit</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.rows.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2">{new Date(row.date).toLocaleDateString()}</td>
                  <td className="px-4 py-2">{row.description}</td>
                  <td className="px-4 py-2 text-xs text-slate-400">{row.reference}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(row.debit)}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(row.credit)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Payments */}
      {payments.length > 0 && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <h2 className="px-4 pt-4 text-base font-semibold text-slate-900">Credit payments</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Method</th>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{new Date(payment.paidAt).toLocaleString()}</td>
                  <td className="px-4 py-2 font-medium">{formatCurrency(payment.amount)}</td>
                  <td className="px-4 py-2">{payment.paymentMethod}</td>
                  <td className="px-4 py-2">{payment.reference ?? '—'}</td>
                  <td className="px-4 py-2">{payment.createdBy?.fullName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
