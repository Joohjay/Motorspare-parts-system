import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';
import { Button } from '@/components/ui/Button';
import {
  ErrorState,
  Field,
  FormError,
  LoadingState,
  TextInput,
  errorMessage,
} from '@/components/ui/FormControls';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/inventoryApi';
import { saleStatusClasses, saleStatusLabels, salesApi } from '@/lib/salesApi';
import type { Sale } from '@/types/api';

export function SaleDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [sale, setSale] = useState<Sale | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { sale: loaded } = await salesApi.get(id);
      setSale(loaded);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load the sale'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitVoid = async (): Promise<void> => {
    if (!voidReason.trim()) {
      setActionError('A reason is required to void a sale');
      return;
    }
    setVoidBusy(true);
    setActionError(null);
    try {
      await salesApi.void(id, voidReason.trim());
      setVoiding(false);
      await load();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not void the sale'));
    } finally {
      setVoidBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="p-6">
        <ErrorState message={loadError} />
      </div>
    );
  }
  if (!sale) {
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
          <Link to="/sales" className="text-sm text-brand-700 hover:underline">
            ← Sales
          </Link>{' '}
          <Link to={`/sales/${sale.id}/receipt`} className="text-sm text-slate-500 hover:text-brand-700 hover:underline">
            · Print receipt
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{sale.saleNumber}</h1>
          <p className="text-sm text-slate-500">{new Date(sale.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${saleStatusClasses[sale.status]}`}
          >
            {saleStatusLabels[sale.status]}
          </span>
          {isAdmin && sale.status === 'COMPLETED' && (
            <>
              <Button variant="danger" onClick={() => setVoiding(true)}>
                Void sale
              </Button>
            </>
          )}
        </div>
      </div>

      <FormError message={actionError} />

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Unit price</th>
              <th className="px-4 py-2 text-right">Total</th>
              {isAdmin && <th className="px-4 py-2 text-right">Unit cost</th>}
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <span className="font-medium text-slate-800">{item.name}</span>
                  <span className="ml-2 text-xs text-slate-400">{item.sku}</span>
                </td>
                <td className="px-4 py-2 text-right">{item.quantity}</td>
                <td className="px-4 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="px-4 py-2 text-right">{formatCurrency(item.lineTotal)}</td>
                {isAdmin && <td className="px-4 py-2 text-right">{formatCurrency(item.unitCost ?? '0')}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 text-sm">
            <tr>
              <td colSpan={isAdmin ? 3 : 3} />
              <td className="px-4 py-1 text-right text-slate-500">Subtotal</td>
              <td className="px-4 py-1 text-right">{formatCurrency(sale.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={isAdmin ? 3 : 3} />
              <td className="px-4 py-1 text-right text-slate-500">Discount</td>
              <td className="px-4 py-1 text-right">−{formatCurrency(sale.discount)}</td>
            </tr>
            <tr>
              <td colSpan={isAdmin ? 3 : 3} />
              <td className="px-4 py-1 pb-2 text-right font-semibold text-slate-900">Total</td>
              <td className="px-4 py-1 pb-2 text-right font-semibold text-slate-900">
                {formatCurrency(sale.totalAmount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Payments</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {sale.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between">
                <span>
                  {payment.paymentMethod}
                  {payment.reference ? ` · ${payment.reference}` : ''}
                </span>
                <span className="font-medium text-slate-900">{formatCurrency(payment.amount)}</span>
              </li>
            ))}
          </ul>
        </section>

        {isAdmin && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Margin</h2>
            <p className="mt-2 text-sm text-slate-600">
              Product cost {formatCurrency(sale.cogs ?? '0')} · Gross profit{' '}
              {formatCurrency(sale.grossProfit ?? '0')}
            </p>
          </section>
        )}
      </div>

      {/* Void dialog */}
      {voiding && (
        <Modal title={`Void ${sale.saleNumber}`} onClose={() => setVoiding(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Voiding restores stock at the original cost and marks the sale
              as voided. This cannot be undone.
            </p>
            <Field label="Reason" htmlFor="void-reason" required>
              <TextInput
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
              />
            </Field>
            <FormError message={actionError} />
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setVoiding(false)} disabled={voidBusy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void submitVoid()} disabled={voidBusy}>
                {voidBusy ? 'Voiding…' : 'Void sale'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
