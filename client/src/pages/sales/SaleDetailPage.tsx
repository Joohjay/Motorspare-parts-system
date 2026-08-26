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
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/inventoryApi';
import {
  returnConditionLabels,
  saleStatusClasses,
  saleStatusLabels,
  salesApi,
  salesReturnsApi,
} from '@/lib/salesApi';
import type { ReturnCondition, Sale, SaleReturn } from '@/types/api';

interface ReturnLine {
  saleItemId: string;
  name: string;
  quantitySold: number;
  quantityReturned: number;
  quantity: number;
  condition: ReturnCondition;
}

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

  const [returning, setReturning] = useState(false);
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([]);
  const [returnReason, setReturnReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [creditAdjusted, setCreditAdjusted] = useState(false);
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnResult, setReturnResult] = useState<SaleReturn | null>(null);

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

  const openReturnDialog = (): void => {
    if (!sale) return;
    setReturnLines(
      sale.items.map((item) => ({
        saleItemId: item.id,
        name: item.name,
        quantitySold: item.quantity,
        quantityReturned: 0,
        quantity: 0,
        condition: 'GOOD' as ReturnCondition,
      })),
    );
    setReturnReason('');
    setCreditAdjusted(false);
    setRefundMethod('CASH');
    setActionError(null);
    setReturning(true);
  };

  const submitReturn = async (): Promise<void> => {
    const items = returnLines
      .filter((line) => line.quantity > 0)
      .map((line) => ({ saleItemId: line.saleItemId, quantity: line.quantity, condition: line.condition }));
    if (items.length === 0) {
      setActionError('Enter at least one quantity to return');
      return;
    }
    if (!returnReason.trim()) {
      setActionError('A reason is required');
      return;
    }
    setReturnBusy(true);
    setActionError(null);
    try {
      const result = await salesReturnsApi.create(id, {
        items,
        reason: returnReason.trim(),
        creditAdjusted,
        refundMethod: creditAdjusted ? undefined : (refundMethod as never),
      });
      setReturnResult(result.return);
      setReturning(false);
      await load();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not record the return'));
    } finally {
      setReturnBusy(false);
    }
  };

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
          <p className="text-sm text-slate-500">
            {sale.customer ? sale.customer.name : 'Walk-in'} · {new Date(sale.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${saleStatusClasses[sale.status]}`}
          >
            {saleStatusLabels[sale.status]}
          </span>
          {isAdmin && sale.status === 'COMPLETED' && (
            <>
              <Button variant="secondary" onClick={openReturnDialog}>
                Process return
              </Button>
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

        {(isAdmin || (sale.returns ?? []).length > 0) && (
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">Returns</h2>
            {(sale.returns ?? []).length === 0 ? (
              <EmptyState message="No returns against this sale." />
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {sale.returns.map((ret) => (
                  <li key={ret.id} className="flex justify-between">
                    <Link to={`/sales/returns`} className="text-brand-700 hover:underline">
                      {ret.returnNumber}
                    </Link>
                    <span>{formatCurrency(ret.totalAmount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {isAdmin && (
              <p className="mt-3 text-xs text-slate-400">
                Product cost {formatCurrency(sale.cogs ?? '0')} · Gross profit{' '}
                {formatCurrency(sale.grossProfit ?? '0')}
              </p>
            )}
          </section>
        )}
      </div>

      {/* Void dialog */}
      {voiding && (
        <Modal title={`Void ${sale.saleNumber}`} onClose={() => setVoiding(false)}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Voiding restores stock at the original cost and reverses any customer credit. This
              cannot be undone.
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

      {/* Return dialog */}
      {returning && (
        <Modal title={`Return against ${sale.saleNumber}`} onClose={() => setReturning(false)} className="max-w-2xl">
          <div className="space-y-3">
            {returnLines.map((line, index) => (
              <div key={line.saleItemId} className="grid grid-cols-6 items-end gap-2 rounded-md border border-slate-100 p-3">
                <div className="col-span-3">
                  <p className="text-sm font-medium text-slate-800">{line.name}</p>
                  <p className="text-xs text-slate-400">Sold: {line.quantitySold}</p>
                </div>
                <Field label="Qty" htmlFor={`ret-qty-${index}`}>
                  <TextInput
                    id={`ret-qty-${index}`}
                    type="number"
                    min={0}
                    max={line.quantitySold}
                    value={line.quantity}
                    onChange={(e) =>
                      setReturnLines((current) =>
                        current.map((l, i) =>
                          i === index
                            ? { ...l, quantity: Math.max(0, Math.min(Number(e.target.value) || 0, l.quantitySold)) }
                            : l,
                        ),
                      )
                    }
                  />
                </Field>
                <div className="col-span-2">
                  <Field label="Condition" htmlFor={`ret-cond-${index}`}>
                    <SelectInput
                      id={`ret-cond-${index}`}
                      value={line.condition}
                      onChange={(e) =>
                        setReturnLines((current) =>
                          current.map((l, i) =>
                            i === index ? { ...l, condition: e.target.value as ReturnCondition } : l,
                          ),
                        )
                      }
                    >
                      {Object.entries(returnConditionLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </SelectInput>
                  </Field>
                </div>
              </div>
            ))}

            <Field label="Reason" htmlFor="return-reason" required>
              <TextInput
                id="return-reason"
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={creditAdjusted}
                  onChange={(e) => setCreditAdjusted(e.target.checked)}
                />
                Adjust customer credit balance instead of refunding
              </label>
              {!creditAdjusted && (
                <select
                  aria-label="Refund method"
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {['CASH', 'MPESA', 'BANK', 'CHEQUE', 'OTHER'].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <FormError message={actionError} />
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setReturning(false)} disabled={returnBusy}>
                Cancel
              </Button>
              <Button onClick={() => void submitReturn()} disabled={returnBusy}>
                {returnBusy ? 'Recording…' : 'Record return'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Return success */}
      {returnResult && (
        <Modal title="Return recorded" onClose={() => setReturnResult(null)}>
          <p className="text-sm text-slate-600">
            {returnResult.returnNumber} recorded for{' '}
            <strong className="text-slate-900">{formatCurrency(returnResult.totalAmount)}</strong>
            {returnResult.creditAdjusted ? ', adjusted against the customer credit balance.' : '.'}
          </p>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => setReturnResult(null)}>Done</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
