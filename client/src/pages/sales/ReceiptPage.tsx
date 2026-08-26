import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState, errorMessage } from '@/components/ui/FormControls';
import { formatCurrency } from '@/lib/inventoryApi';
import { receiptsApi } from '@/lib/stage8Api';
import type { ReceiptData as ReceiptDataShape } from '@/types/api';

/**
 * Printable receipt (Stage 8). Renders the frozen sale snapshot plus current
 * business settings. Printing uses a dedicated print stylesheet that hides
 * the application shell so only the receipt reaches paper.
 */
export function ReceiptPage(): ReactElement {
  const { id = '' } = useParams();
  const [receipt, setReceipt] = useState<ReceiptDataShape | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await receiptsApi.get(id);
      setReceipt(response.receipt);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the receipt'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} />;
  if (!receipt) return <LoadingState label="Preparing receipt…" />;

  const { business, sale, customerCreditOutstanding } = receipt;
  const businessName = business['business.name'] ?? 'JM SPAREPARTS';

  return (
    <div className="space-y-4">
      <div className="print:hidden flex items-center justify-between">
        <Link to={`/sales/${sale.id}`} className="text-sm font-medium text-brand-700 hover:underline">← Back to sale</Link>
        <Button onClick={() => window.print()}>Print receipt</Button>
      </div>

      <div
        id="receipt-paper"
        className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <header className="text-center">
          <h1 className="text-lg font-bold uppercase tracking-wide">{businessName}</h1>
          {business['business.address'] ? <p className="text-xs text-slate-500">{business['business.address']}</p> : null}
          <p className="text-xs text-slate-500">
            {[business['business.phone'], business['business.email']].filter(Boolean).join(' · ')}
          </p>
        </header>

        <div className="mt-4 border-y border-dashed border-slate-300 py-2 text-xs">
          <div className="flex justify-between">
            <span>
              Receipt: <span className="font-semibold">{sale.saleNumber}</span>
            </span>
            <span>{new Date(sale.createdAt).toLocaleString()}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Type: {sale.saleType === 'WHOLESALE' ? 'Wholesale' : 'Retail'}</span>
            <span>Cashier: {sale.createdBy?.fullName ?? '—'}</span>
          </div>
          {sale.customer ? (
            <p className="mt-1">Customer: {sale.customer.name}</p>
          ) : null}
        </div>

        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th scope="col" className="py-1 font-semibold">Item</th>
              <th scope="col" className="py-1 text-right font-semibold">Qty</th>
              <th scope="col" className="py-1 text-right font-semibold">Price</th>
              <th scope="col" className="py-1 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dashed divide-slate-200">
            {sale.items.map((item) => (
              <tr key={item.id}>
                <td className="py-1 pr-2 align-top">
                  <span className="block font-medium">{item.name}</span>
                  <span className="block font-mono text-[10px] text-slate-400">{item.sku}</span>
                </td>
                <td className="py-1 text-right align-top tabular-nums">{item.quantity}</td>
                <td className="py-1 text-right align-top tabular-nums">{formatCurrency(item.unitPrice)}</td>
                <td className="py-1 text-right align-top tabular-nums">{formatCurrency(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-3 space-y-1 border-t border-slate-300 pt-2 text-xs">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatCurrency(sale.subtotal)}</dd>
          </div>
          {Number(sale.discount) > 0 ? (
            <div className="flex justify-between">
              <dt>Discount</dt>
              <dd className="tabular-nums">−{formatCurrency(sale.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-slate-300 pt-1 text-sm font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatCurrency(sale.totalAmount)}</dd>
          </div>
          {sale.payments.map((payment) => (
            <div key={payment.id} className="flex justify-between text-slate-600">
              <dt>Paid — {payment.paymentMethod.replace('_', ' ')}</dt>
              <dd className="tabular-nums">{formatCurrency(payment.amount)}</dd>
            </div>
          ))}
          {Number(sale.creditAmount) > 0 ? (
            <div className="flex justify-between font-medium text-red-700">
              <dt>On credit</dt>
              <dd className="tabular-nums">{formatCurrency(sale.creditAmount)}</dd>
            </div>
          ) : null}
          {customerCreditOutstanding !== null ? (
            <div className="flex justify-between text-slate-500">
              <dt>Customer credit balance after this sale</dt>
              <dd className="tabular-nums">{formatCurrency(customerCreditOutstanding)}</dd>
            </div>
          ) : null}
        </dl>

        {sale.status !== 'COMPLETED' ? (
          <p className="mt-3 rounded bg-red-50 px-2 py-1 text-center text-xs font-semibold text-red-700">
            THIS SALE WAS VOIDED — NOT A VALID RECEIPT
          </p>
        ) : null}

        <footer className="mt-4 text-center text-xs text-slate-500">
          {business['business.receiptFooter'] ? <p>{business['business.receiptFooter']}</p> : null}
        </footer>
      </div>
    </div>
  );
}
