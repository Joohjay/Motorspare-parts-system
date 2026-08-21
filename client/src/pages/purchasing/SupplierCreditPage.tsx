import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
import { ApiClientError } from '@/lib/api';
import {
  paymentMethodLabels,
  supplierCreditApi,
  suppliersApi,
} from '@/lib/purchasingApi';
import type { Supplier, SupplierCreditAccount } from '@/types/api';

function formatMoney(value: string | number): string {
  const num = Number(value);
  return Number.isFinite(num)
    ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function SupplierCreditPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [account, setAccount] = useState<SupplierCreditAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [openTarget, setOpenTarget] = useState<Supplier | null>(null);
  const [openBusy, setOpenBusy] = useState(false);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    suppliersApi
      .list({ pageSize: 500 })
      .then((data) => setSuppliers(data.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!supplierId) {
      setAccount(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    supplierCreditApi
      .get(supplierId)
      .then((data) => {
        if (!active) return;
        setAccount(data.creditAccount);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setAccount(null);
          setLoading(false);
          return;
        }
        setError(errorMessage(err, 'Unable to load the credit account.'));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [supplierId, reloadTick]);

  async function openAccount() {
    if (!openTarget) return;
    setOpenBusy(true);
    setPayError(null);
    try {
      await supplierCreditApi.openAccount(openTarget.id);
      setSuccess(`Credit account opened for ${openTarget.name}.`);
      setOpenTarget(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setPayError(err instanceof ApiClientError ? err.message : 'Unable to open the credit account.');
    } finally {
      setOpenBusy(false);
    }
  }

  async function recordPayment() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setPayError('Enter a positive payment amount.');
      return;
    }
    setPayBusy(true);
    setPayError(null);
    try {
      await supplierCreditApi.recordPayment(supplierId, {
        amount: value,
        paymentMethod: method,
        reference: reference.trim() || null,
      });
      setSuccess(`Payment of ${formatMoney(value)} recorded.`);
      setAmount('');
      setReference('');
      setReloadTick((t) => t + 1);
    } catch (err) {
      setPayError(err instanceof ApiClientError ? err.message : 'Unable to record the payment.');
    } finally {
      setPayBusy(false);
    }
  }

  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Supplier credit</h1>
        <p className="mt-1 text-sm text-slate-500">
          Outstanding balances owed to suppliers and payments against them.
        </p>
      </div>

      <nav className="flex gap-4 text-sm text-slate-500">
        <Link to="/purchasing/purchase-orders" className="hover:text-brand-600">
          Orders
        </Link>
        <Link to="/purchasing/purchases" className="hover:text-brand-600">
          Receiving
        </Link>
        <Link to="/purchasing/suppliers" className="hover:text-brand-600">
          Suppliers
        </Link>
        <span className="font-medium text-brand-600">Credit</span>
      </nav>

      {success && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      )}

      <Card className="max-w-md p-4">
        <Field label="Supplier" htmlFor="credit-supplier">
          <SelectInput id="credit-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      </Card>

      {error && <ErrorState message={error} />}

      {!supplierId ? null : loading ? (
        <LoadingState label="Loading credit account…" />
      ) : !account ? (
        <EmptyState message="This supplier has no credit account. Purchases are not charged to credit." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Outstanding balance</h2>
                <p className="text-2xl font-bold tabular-nums text-slate-900">{formatMoney(account.outstandingBalance)}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>{account._count.purchases} purchase{account._count.purchases === 1 ? '' : 's'} on credit</p>
                <p>{account._count.payments} payment{account._count.payments === 1 ? '' : 's'} recorded</p>
              </div>
            </div>
            {account.payments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No payments recorded yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Paid at</th>
                    <th className="px-4 py-2 font-medium">Purchase</th>
                    <th className="px-4 py-2 font-medium">Method</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {account.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 text-slate-600">{formatDateTime(p.paidAt)}</td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">
                        {p.purchase ? p.purchase.purchaseNumber : '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{paymentMethodLabels[p.paymentMethod] ?? p.paymentMethod}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatMoney(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {isAdmin && (
            <Card className="h-fit p-4">
              <h2 className="text-sm font-semibold text-slate-900">Record a payment</h2>
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void recordPayment();
                }}
              >
                <Field label="Amount" htmlFor="pay-amount" required>
                  <TextInput
                    id="pay-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Method" htmlFor="pay-method">
                  <SelectInput id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank transfer</option>
                    <option value="MPESA">M-Pesa</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="OTHER">Other</option>
                  </SelectInput>
                </Field>
                <Field label="Reference" htmlFor="pay-reference">
                  <TextInput id="pay-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
                <FormError message={payError} />
                <Button type="submit" disabled={payBusy || account.outstandingBalance === '0'} className="w-full">
                  {payBusy ? 'Recording…' : 'Record payment'}
                </Button>
                {account.outstandingBalance === '0' && (
                  <p className="text-center text-xs text-slate-400">Balance fully settled.</p>
                )}
              </form>
            </Card>
          )}
        </div>
      )}

      {isAdmin && selectedSupplier && !account && !loading && (
        <Card className="max-w-md p-4">
          <p className="text-sm text-slate-600">
            Open a credit account for <span className="font-medium">{selectedSupplier.name}</span>? Purchases received
            while the account is active will increase the outstanding balance.
          </p>
          <Button className="mt-3" onClick={() => setOpenTarget(selectedSupplier)}>
            Open credit account
          </Button>
        </Card>
      )}

      {payError && !account && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {payError}
        </p>
      )}

      {openTarget && (
        <ConfirmDialog
          title="Open credit account"
          message={`Open a credit account for ${openTarget.name}?`}
          confirmLabel="Open account"
          busyLabel="Opening…"
          busy={openBusy}
          onConfirm={() => void openAccount()}
          onCancel={() => setOpenTarget(null)}
        />
      )}
    </div>
  );
}
